import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AttachmentManager } from './AttachmentManager';
import type { AssetFile, AssetRecord } from '../../types/assets';

describe('AttachmentManager', () => {
  const baseAsset: AssetRecord = {
    id: 1,
    title: 'Asset',
    entry_date: '2024-01-01',
    commissioning_date: '2024-01-02',
    station_name: 'Station',
    technician: 'Technician',
    start_date: '2024-01-03',
    end_date: '2024-01-04',
    service: 'Service',
    staff: [],
    latitude: 0,
    longitude: 0,
    pitch: 0,
    roll: 0,
    attachments: [],
    image_urls: [],
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
  };

  it('renders notice when storage is not configured', () => {
    render(
      <AttachmentManager
        asset={baseAsset}
        onUpload={jest.fn()}
        onDelete={jest.fn()}
        storageConfigured={false}
        maxUploadSizeBytes={0}
      />
    );

    expect(screen.getByText(/uploads disabled/i)).toBeInTheDocument();
    expect(screen.getByTestId('data-testid pg-one-attachments-upload')).toBeDisabled();
  });

  it('invokes onUpload when a file is selected', async () => {
    const upload = jest.fn().mockResolvedValue(createFileRecord());
    render(
      <AttachmentManager
        asset={baseAsset}
        onUpload={upload}
        onDelete={jest.fn()}
        storageConfigured={true}
        maxUploadSizeBytes={10 * 1024 * 1024}
      />
    );

    const input = screen.getByTestId('data-testid pg-one-attachments-upload') as HTMLInputElement;
    const file = new File(['hello'], 'test.txt', { type: 'text/plain' });

    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
    expect(upload).toHaveBeenCalledWith(file);
  });

  it('prevents uploads larger than the limit', () => {
    render(
      <AttachmentManager
        asset={baseAsset}
        onUpload={jest.fn()}
        onDelete={jest.fn()}
        storageConfigured={true}
        maxUploadSizeBytes={4}
      />
    );

    const input = screen.getByTestId('data-testid pg-one-attachments-upload') as HTMLInputElement;
    const file = new File(['hello'], 'big.txt', { type: 'text/plain' });

    fireEvent.change(input, { target: { files: [file] } });

    expect(screen.getByText(/file exceeds the maximum size/i)).toBeInTheDocument();
  });

  it('calls onDelete when delete is clicked', async () => {
    const attachments: AssetFile[] = [
      {
        id: 10,
        asset_id: 1,
        file_name: 'doc.pdf',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      },
    ];

    const asset: AssetRecord = { ...baseAsset, attachments };
    const onDelete = jest.fn().mockResolvedValue(undefined);

    render(
      <AttachmentManager
        asset={asset}
        onUpload={jest.fn()}
        onDelete={onDelete}
        storageConfigured={true}
        maxUploadSizeBytes={10 * 1024 * 1024}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /delete/i }));

    await waitFor(() => expect(onDelete).toHaveBeenCalledWith(10));
  });
});

function createFileRecord(): AssetFile {
  return {
    id: 123,
    asset_id: 1,
    file_name: 'upload.txt',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
  };
}
