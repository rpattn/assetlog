package plugin

import (
	"context"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

var errStorageNotConfigured = errors.New("storage not configured")

const signedURLTTL = time.Hour

// StorageClient defines the interface used by the plugin to interact with
// object storage.
type StorageClient interface {
	Upload(ctx context.Context, object string, r io.Reader, size int64, contentType string) error
	Delete(ctx context.Context, object string) error
	SignedURL(ctx context.Context, object string, expires time.Duration) (string, error)
	Close() error
}

type gcsStorage struct {
	bucketName  string
	prefix      string
	signerEmail string
	privateKey  *rsa.PrivateKey
	httpClient  *http.Client
}

type localStorage struct {
	root   string
	prefix string
}

type serviceAccountCredentials struct {
	ClientEmail string `json:"client_email"`
	PrivateKey  string `json:"private_key"`
}

func newStorageClient(ctx context.Context, cfg StorageConfig) (StorageClient, error) {
	if !cfg.IsFullyConfigured() {
		return nil, errStorageNotConfigured
	}
	if localStorageOverrideEnabled() {
		return newLocalStorage(cfg)
	}
	return newGCSStorage(ctx, cfg)
}

func newGCSStorage(_ context.Context, cfg StorageConfig) (StorageClient, error) {
	if strings.TrimSpace(cfg.Bucket) == "" {
		return nil, errors.New("gcs bucket not configured")
	}

	var creds serviceAccountCredentials
	if err := json.Unmarshal(cfg.ServiceAccountJSON, &creds); err != nil {
		return nil, fmt.Errorf("decode service account: %w", err)
	}
	if strings.TrimSpace(creds.ClientEmail) == "" {
		return nil, errors.New("service account missing client_email")
	}
	if strings.TrimSpace(creds.PrivateKey) == "" {
		return nil, errors.New("service account missing private_key")
	}

	block, _ := pem.Decode([]byte(creds.PrivateKey))
	if block == nil {
		return nil, errors.New("invalid service account private key")
	}
	parsedKey, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		pkcs1Key, errPKCS1 := x509.ParsePKCS1PrivateKey(block.Bytes)
		if errPKCS1 != nil {
			return nil, fmt.Errorf("parse private key: %w", err)
		}
		parsedKey = pkcs1Key
	}
	rsaKey, ok := parsedKey.(*rsa.PrivateKey)
	if !ok {
		return nil, errors.New("service account private key is not RSA")
	}

	return &gcsStorage{
		bucketName:  cfg.Bucket,
		prefix:      strings.Trim(cfg.Prefix, "/"),
		signerEmail: creds.ClientEmail,
		privateKey:  rsaKey,
		httpClient: &http.Client{
			Timeout: 60 * time.Second,
		},
	}, nil
}

func newLocalStorage(cfg StorageConfig) (StorageClient, error) {
	basePath := os.Getenv("ASSETLOG_STORAGE_PATH")
	if strings.TrimSpace(basePath) == "" {
		basePath = filepath.Join(os.TempDir(), "assetlog-storage")
	}
	bucket := strings.TrimSpace(cfg.Bucket)
	if bucket == "" {
		bucket = "local"
	}
	root := filepath.Join(basePath, bucket)
	if err := os.MkdirAll(root, 0o755); err != nil {
		return nil, fmt.Errorf("create storage root: %w", err)
	}
	return &localStorage{root: root, prefix: strings.Trim(cfg.Prefix, "/")}, nil
}

func (s *gcsStorage) Upload(ctx context.Context, object string, r io.Reader, size int64, contentType string) error {
	rel := s.prefixed(object)
	if strings.TrimSpace(contentType) == "" {
		contentType = "application/octet-stream"
	}
	signedURL, err := s.signURL(http.MethodPut, rel, contentType, 15*time.Minute)
	if err != nil {
		return fmt.Errorf("sign upload url: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPut, signedURL, r)
	if err != nil {
		return fmt.Errorf("create upload request: %w", err)
	}
	req.Header.Set("Content-Type", contentType)
	if size >= 0 {
		req.ContentLength = size
	}
	resp, err := s.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("execute upload: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
		return fmt.Errorf("upload failed with status %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	return nil
}

func (s *gcsStorage) Delete(ctx context.Context, object string) error {
	rel := s.prefixed(object)
	signedURL, err := s.signURL(http.MethodDelete, rel, "", 15*time.Minute)
	if err != nil {
		return fmt.Errorf("sign delete url: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodDelete, signedURL, http.NoBody)
	if err != nil {
		return fmt.Errorf("create delete request: %w", err)
	}
	resp, err := s.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("execute delete: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusNotFound {
		return nil
	}
	if resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
		return fmt.Errorf("delete failed with status %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	return nil
}

func (s *gcsStorage) SignedURL(_ context.Context, object string, expires time.Duration) (string, error) {
	rel := s.prefixed(object)
	signedURL, err := s.signURL(http.MethodGet, rel, "", expires)
	if err != nil {
		return "", fmt.Errorf("generate signed url: %w", err)
	}
	return signedURL, nil
}

func (s *gcsStorage) Close() error { return nil }

func (s *gcsStorage) prefixed(object string) string {
	object = strings.TrimLeft(object, "/")
	if s.prefix == "" {
		return object
	}
	return strings.TrimLeft(path.Join(s.prefix, object), "/")
}

func (s *localStorage) Upload(_ context.Context, object string, r io.Reader, _ int64, _ string) error {
	rel := s.prefixed(object)
	full := filepath.Join(s.root, filepath.FromSlash(rel))
	if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
		return fmt.Errorf("create storage directory: %w", err)
	}
	data, err := io.ReadAll(r)
	if err != nil {
		return fmt.Errorf("read upload: %w", err)
	}
	if err := os.WriteFile(full, data, 0o644); err != nil {
		return fmt.Errorf("write object: %w", err)
	}
	return nil
}

func (s *localStorage) Delete(_ context.Context, object string) error {
	rel := s.prefixed(object)
	full := filepath.Join(s.root, filepath.FromSlash(rel))
	if err := os.Remove(full); err != nil && !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("remove object: %w", err)
	}
	return nil
}

func (s *localStorage) SignedURL(_ context.Context, object string, _ time.Duration) (string, error) {
	rel := s.prefixed(object)
	full := filepath.Join(s.root, filepath.FromSlash(rel))
	return "file://" + filepath.ToSlash(full), nil
}

func (s *localStorage) Close() error { return nil }

func (s *localStorage) prefixed(object string) string {
	object = strings.TrimLeft(object, "/")
	if s.prefix == "" {
		return object
	}
	return strings.TrimLeft(path.Join(s.prefix, object), "/")
}

func (s *gcsStorage) signURL(method, object, contentType string, expires time.Duration) (string, error) {
	if expires <= 0 {
		expires = signedURLTTL
	}
	expiration := time.Now().Add(expires).Unix()
	resource := fmt.Sprintf("/%s/%s", s.bucketName, object)
	stringToSign := strings.Join([]string{method, "", contentType, strconv.FormatInt(expiration, 10), resource}, "\n")
	digest := sha256.Sum256([]byte(stringToSign))
	signature, err := rsa.SignPKCS1v15(rand.Reader, s.privateKey, crypto.SHA256, digest[:])
	if err != nil {
		return "", fmt.Errorf("sign string: %w", err)
	}
	values := url.Values{}
	values.Set("GoogleAccessId", s.signerEmail)
	values.Set("Expires", strconv.FormatInt(expiration, 10))
	values.Set("Signature", base64.StdEncoding.EncodeToString(signature))
	escapedObject := escapeGCSObject(object)
	return fmt.Sprintf("https://storage.googleapis.com/%s/%s?%s", s.bucketName, escapedObject, values.Encode()), nil
}

func escapeGCSObject(object string) string {
	if object == "" {
		return ""
	}
	parts := strings.Split(object, "/")
	for i, part := range parts {
		parts[i] = url.PathEscape(part)
	}
	return strings.Join(parts, "/")
}

// sanitizeObjectName removes any characters that could lead to unsafe object
// names when constructing keys from user provided filenames.
func sanitizeObjectName(name string) string {
	name = path.Base(name)
	name = strings.TrimSpace(name)
	if name == "" {
		return ""
	}
	cleaned := strings.Map(func(r rune) rune {
		switch {
		case r == '/' || r == '\\':
			return -1
		case r < 32:
			return -1
		}
		return r
	}, name)
	cleaned = strings.TrimSpace(cleaned)
	if cleaned == "" {
		return ""
	}
	return cleaned
}
