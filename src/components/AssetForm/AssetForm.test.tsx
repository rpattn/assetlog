import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AssetForm } from './AssetForm';

const defaultSubmit = jest.fn();
const defaultCancel = jest.fn();

describe('AssetForm', () => {
  beforeEach(() => {
    defaultSubmit.mockReset();
    defaultCancel.mockReset();
  });

  it('submits normalized payload when the form is valid', async () => {
    render(
      <AssetForm
        submitLabel="Save"
        onSubmit={defaultSubmit}
        onCancel={defaultCancel}
        isSubmitting={false}
      />
    );

    fireEvent.change(screen.getByLabelText(/Title/i), { target: { value: '  Example asset  ' } });
    fireEvent.change(screen.getByLabelText(/Entry date/i), { target: { value: '2024-01-01' } });
    fireEvent.change(screen.getByLabelText(/Commissioning date/i), { target: { value: '2024-01-02' } });
    fireEvent.change(screen.getByLabelText(/Station name/i), { target: { value: 'Station 01' } });
    fireEvent.change(screen.getByLabelText(/Technician/i), { target: { value: 'Alex' } });
    fireEvent.change(screen.getByLabelText(/Start date/i), { target: { value: '2024-02-01' } });
    fireEvent.change(screen.getByLabelText(/End date/i), { target: { value: '2024-02-05' } });
    fireEvent.change(screen.getByLabelText(/Service/i), { target: { value: '  Maintenance ' } });
    fireEvent.change(screen.getByLabelText(/Latitude/i), { target: { value: '1.23' } });
    fireEvent.change(screen.getByLabelText(/Longitude/i), { target: { value: '-4.56' } });
    fireEvent.change(screen.getByLabelText(/Pitch/i), { target: { value: '0.5' } });
    fireEvent.change(screen.getByLabelText(/Roll/i), { target: { value: '-0.75' } });
    fireEvent.change(screen.getByLabelText(/Staff/i), { target: { value: 'Jane\n John  ' } });

    fireEvent.submit(screen.getByTestId('asset-form'));

    await waitFor(() => expect(defaultSubmit).toHaveBeenCalledTimes(1));
    expect(defaultSubmit).toHaveBeenCalledWith({
      title: 'Example asset',
      entry_date: '2024-01-01',
      commissioning_date: '2024-01-02',
      station_name: 'Station 01',
      technician: 'Alex',
      start_date: '2024-02-01',
      end_date: '2024-02-05',
      service: 'Maintenance',
      staff: ['Jane', 'John'],
      latitude: 1.23,
      longitude: -4.56,
      pitch: 0.5,
      roll: -0.75,
    });
  });

  it('prevents submission when fields are missing', async () => {
    render(
      <AssetForm submitLabel="Save" onSubmit={defaultSubmit} onCancel={defaultCancel} isSubmitting={false} />
    );

    fireEvent.submit(screen.getByTestId('asset-form'));

    await waitFor(() => expect(defaultSubmit).not.toHaveBeenCalled());
    expect(screen.getAllByText(/title is required/i).length).toBeGreaterThan(0);
  });

  it('shows an error when numeric fields contain invalid values', async () => {
    render(
      <AssetForm submitLabel="Save" onSubmit={defaultSubmit} onCancel={defaultCancel} isSubmitting={false} />
    );

    fireEvent.change(screen.getByLabelText(/Title/i), { target: { value: 'Asset' } });
    fireEvent.change(screen.getByLabelText(/Entry date/i), { target: { value: '2024-01-01' } });
    fireEvent.change(screen.getByLabelText(/Commissioning date/i), { target: { value: '2024-01-02' } });
    fireEvent.change(screen.getByLabelText(/Station name/i), { target: { value: 'Station 01' } });
    fireEvent.change(screen.getByLabelText(/Technician/i), { target: { value: 'Alex' } });
    fireEvent.change(screen.getByLabelText(/Start date/i), { target: { value: '2024-02-01' } });
    fireEvent.change(screen.getByLabelText(/End date/i), { target: { value: '2024-02-05' } });
    fireEvent.change(screen.getByLabelText(/Latitude/i), { target: { value: 'not-a-number' } });

    fireEvent.submit(screen.getByTestId('asset-form'));

    await waitFor(() => expect(defaultSubmit).not.toHaveBeenCalled());
    expect(screen.getAllByText(/must be a number/i).length).toBeGreaterThan(0);
  });
});
