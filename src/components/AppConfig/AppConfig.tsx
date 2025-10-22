import React, { ChangeEvent, useEffect, useState } from 'react';
import { lastValueFrom } from 'rxjs';
import { css } from '@emotion/css';
import { AppPluginMeta, GrafanaTheme2, PluginConfigPageProps, PluginMeta } from '@grafana/data';
import { getBackendSrv } from '@grafana/runtime';
import { Button, Field, FieldSet, Input, SecretInput, useStyles2 } from '@grafana/ui';
import { testIds } from '../testIds';

type AppPluginSettings = {
  apiUrl?: string;
  bucketName?: string;
  objectPrefix?: string;
  maxUploadSizeMb?: number;
};

type PersistedAppSettingsResponse = {
  jsonData?: {
    apiUrl?: string;
    bucketName?: string;
    objectPrefix?: string;
    maxUploadSizeMb?: number;
  };
  secureJsonFields?: {
    apiKey?: boolean;
    gcsServiceAccount?: boolean;
  };
  storage?: {
    configured?: boolean;
    error?: string;
  };
};

type State = {
  // The URL to reach our custom API.
  apiUrl: string;
  // Tells us if the API key secret is set.
  isApiKeySet: boolean;
  // A secret key for our custom API.
  apiKey: string;
  // Storage bucket where uploaded files will be stored.
  bucketName: string;
  // Optional prefix for objects inside the storage bucket.
  objectPrefix: string;
  // Maximum upload size in megabytes.
  maxUploadSizeMb: string;
  // Raw service account JSON used to access the storage bucket.
  serviceAccount: string;
  // Tells us if the service account JSON is already configured.
  isServiceAccountSet: boolean;
};

export interface AppConfigProps extends PluginConfigPageProps<AppPluginMeta<AppPluginSettings>> {}

const DEFAULT_MAX_UPLOAD_SIZE_MB = 25;
const MAX_UPLOAD_SIZE_LIMIT_MB = 5120; // 5 GiB cap to avoid misconfiguration.

const AppConfig = ({ plugin }: AppConfigProps) => {
  const s = useStyles2(getStyles);
  const { enabled, pinned, jsonData, secureJsonFields } = plugin.meta;
  const [state, setState] = useState<State>({
    apiUrl: jsonData?.apiUrl || '',
    apiKey: '',
    isApiKeySet: Boolean(secureJsonFields?.apiKey),
    bucketName: jsonData?.bucketName || '',
    objectPrefix: jsonData?.objectPrefix || '',
    maxUploadSizeMb:
      jsonData?.maxUploadSizeMb && jsonData.maxUploadSizeMb > 0
        ? String(jsonData.maxUploadSizeMb)
        : String(DEFAULT_MAX_UPLOAD_SIZE_MB),
    serviceAccount: '',
    isServiceAccountSet: Boolean(secureJsonFields?.gcsServiceAccount),
  });

  useEffect(() => {
    let isMounted = true;

    const loadPersistedSettings = async () => {
      try {
        const response = await getBackendSrv().get<PersistedAppSettingsResponse>(
          `/api/plugins/${plugin.meta.id}/resources/app-settings`,
          undefined,
          undefined,
          { showErrorAlert: false }
        );

        if (!isMounted || !response) {
          return;
        }

        setState((prev) => {
          const next = { ...prev };
          const persisted = response.jsonData ?? {};
          if (typeof persisted.apiUrl === 'string') {
            next.apiUrl = persisted.apiUrl;
          }
          if (typeof persisted.bucketName === 'string') {
            next.bucketName = persisted.bucketName;
          }
          if (typeof persisted.objectPrefix === 'string') {
            next.objectPrefix = persisted.objectPrefix;
          }
          if (
            typeof persisted.maxUploadSizeMb === 'number' &&
            Number.isFinite(persisted.maxUploadSizeMb) &&
            persisted.maxUploadSizeMb > 0
          ) {
            next.maxUploadSizeMb = String(persisted.maxUploadSizeMb);
          }

          const secureFields = response.secureJsonFields ?? {};
          if (typeof secureFields.apiKey === 'boolean') {
            next.isApiKeySet = secureFields.apiKey;
          }
          if (typeof secureFields.gcsServiceAccount === 'boolean') {
            next.isServiceAccountSet = secureFields.gcsServiceAccount;
          }

          return next;
        });
      } catch (error) {
        console.error('Failed to load persisted app settings', error);
      }
    };

    loadPersistedSettings();

    return () => {
      isMounted = false;
    };
  }, [plugin.meta.id]);

  const parsedMaxUploadSize = Number(state.maxUploadSizeMb);
  const isUploadSizeValid =
    !Number.isNaN(parsedMaxUploadSize) &&
    Number.isFinite(parsedMaxUploadSize) &&
    parsedMaxUploadSize > 0 &&
    parsedMaxUploadSize <= MAX_UPLOAD_SIZE_LIMIT_MB;
  const isSubmitDisabled = Boolean(
    !state.apiUrl ||
      (!state.isApiKeySet && !state.apiKey) ||
      !state.bucketName ||
      (!state.isServiceAccountSet && !state.serviceAccount) ||
      !isUploadSizeValid
  );

  const onResetApiKey = () =>
    setState({
      ...state,
      apiKey: '',
      isApiKeySet: false,
    });

  const onResetServiceAccount = () =>
    setState({
      ...state,
      serviceAccount: '',
      isServiceAccountSet: false,
    });

  const onChange = (event: ChangeEvent<HTMLInputElement>) => {
    const { name, value } = event.target;
    const nextValue = name === 'maxUploadSizeMb' ? value : value.trim();

    setState({
      ...state,
      [name]: nextValue,
    });
  };

  const onSubmit = () => {
    if (isSubmitDisabled) {
      return;
    }

    const normalizedMaxUploadSizeMb = isUploadSizeValid
      ? Math.max(1, Math.floor(parsedMaxUploadSize))
      : DEFAULT_MAX_UPLOAD_SIZE_MB;

    const secureJsonData: Record<string, string> = {};
    if (!state.isApiKeySet) {
      secureJsonData.apiKey = state.apiKey;
    }
    if (!state.isServiceAccountSet) {
      secureJsonData.gcsServiceAccount = state.serviceAccount;
    }

    updatePluginAndReload(plugin.meta.id, {
      enabled,
      pinned,
      jsonData: {
        apiUrl: state.apiUrl,
        bucketName: state.bucketName,
        objectPrefix: state.objectPrefix,
        maxUploadSizeMb: normalizedMaxUploadSizeMb,
      },
      // These secrets cannot be queried later by the frontend.
      // We don't want to override them in case they were set previously and left untouched now.
      secureJsonData: Object.keys(secureJsonData).length ? secureJsonData : undefined,
    });
  };

  return (
    <form onSubmit={onSubmit}>
      <FieldSet label="API Settings">
        <Field label="API Key" description="A secret key for authenticating to our custom API">
          <SecretInput
            width={60}
            id="config-api-key"
            data-testid={testIds.appConfig.apiKey}
            name="apiKey"
            value={state.apiKey}
            isConfigured={state.isApiKeySet}
            placeholder={'Your secret API key'}
            onChange={onChange}
            onReset={onResetApiKey}
          />
        </Field>

        <Field label="API Url" description="" className={s.marginTop}>
          <Input
            width={60}
            name="apiUrl"
            id="config-api-url"
            data-testid={testIds.appConfig.apiUrl}
            value={state.apiUrl}
            placeholder={`E.g.: http://mywebsite.com/api/v1`}
            onChange={onChange}
          />
        </Field>
      </FieldSet>

      <FieldSet label="Storage Settings" className={s.marginTop}>
        <Field
          label="Bucket name"
          description="Google Cloud Storage bucket where attachments will be stored"
        >
          <Input
            width={60}
            name="bucketName"
            id="config-storage-bucket"
            data-testid={testIds.appConfig.bucketName}
            value={state.bucketName}
            placeholder={`E.g.: my-assetlog-bucket`}
            onChange={onChange}
          />
        </Field>

        <Field
          label="Object prefix"
          description="Optional folder-style prefix to group uploaded files"
          className={s.marginTop}
        >
          <Input
            width={60}
            name="objectPrefix"
            id="config-storage-prefix"
            data-testid={testIds.appConfig.objectPrefix}
            value={state.objectPrefix}
            placeholder={`E.g.: uploads/org-1/`}
            onChange={onChange}
          />
        </Field>

        <Field
          label="Max upload size (MB)"
          description={`Limit individual file uploads (max ${MAX_UPLOAD_SIZE_LIMIT_MB} MB)`}
          className={s.marginTop}
        >
          <Input
            width={20}
            name="maxUploadSizeMb"
            id="config-storage-max-upload"
            data-testid={testIds.appConfig.maxUploadSize}
            value={state.maxUploadSizeMb}
            type="number"
            min={1}
            max={MAX_UPLOAD_SIZE_LIMIT_MB}
            onChange={onChange}
          />
        </Field>

        <Field
          label="Service account JSON"
          description="Paste a Google Cloud service account JSON with storage access"
          className={s.marginTop}
        >
          <SecretInput
            width={60}
            id="config-storage-service-account"
            data-testid={testIds.appConfig.serviceAccount}
            name="serviceAccount"
            value={state.serviceAccount}
            isConfigured={state.isServiceAccountSet}
            placeholder={'Paste the JSON credentials for your service account'}
            onChange={onChange}
            onReset={onResetServiceAccount}
          />
        </Field>

        <div className={s.marginTop}>
          <Button type="submit" data-testid={testIds.appConfig.submit} disabled={isSubmitDisabled}>
            Save API settings
          </Button>
        </div>
      </FieldSet>
    </form>
  );
};

export default AppConfig;

const getStyles = (theme: GrafanaTheme2) => ({
  colorWeak: css`
    color: ${theme.colors.text.secondary};
  `,
  marginTop: css`
    margin-top: ${theme.spacing(3)};
  `,
});

const updatePluginAndReload = async (pluginId: string, data: Partial<PluginMeta<AppPluginSettings>>) => {
  try {
    await updatePlugin(pluginId, data);

    // Reloading the page as the changes made here wouldn't be propagated to the actual plugin otherwise.
    // This is not ideal, however unfortunately currently there is no supported way for updating the plugin state.
    window.location.reload();
  } catch (e) {
    console.error('Error while updating the plugin', e);
  }
};

const updatePlugin = async (pluginId: string, data: Partial<PluginMeta>) => {
  const response = await getBackendSrv().fetch({
    url: `/api/plugins/${pluginId}/settings`,
    method: 'POST',
    data,
  });

  return lastValueFrom(response);
};
