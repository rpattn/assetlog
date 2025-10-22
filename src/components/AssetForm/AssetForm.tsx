import React, { FormEvent, useEffect, useId, useMemo, useState } from 'react';
import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import { useStyles2, Field, Input, TextArea, Alert, Modal, Button } from '@grafana/ui';
import type { AssetPayload, AssetRecord } from '../../types/assets';

type FormState = {
  title: string;
  entry_date: string;
  commissioning_date: string;
  station_name: string;
  technician: string;
  start_date: string;
  end_date: string;
  service: string;
  staffText: string;
  latitude: string;
  longitude: string;
  pitch: string;
  roll: string;
};

type FormErrors = Partial<Record<keyof FormState, string>>;

export interface AssetFormProps {
  asset?: AssetRecord;
  onSubmit(payload: AssetPayload): Promise<void> | void;
  onCancel(): void;
  onClearError?(): void;
  submitLabel: string;
  isSubmitting?: boolean;
  errorMessage?: string | null;
}

export const AssetForm = ({
  asset,
  onSubmit,
  onCancel,
  onClearError,
  submitLabel,
  isSubmitting = false,
  errorMessage,
}: AssetFormProps) => {
  const styles = useStyles2(getStyles);
  const formId = useId();
  const [form, setForm] = useState<FormState>(() => buildFormState(asset));
  const [errors, setErrors] = useState<FormErrors>({});

  useEffect(() => {
    setForm(buildFormState(asset));
    setErrors({});
  }, [asset]);

  const fieldId = useMemo(() => {
    return (name: keyof FormState) => `${formId}-${name}`;
  }, [formId]);

  const handleChange = (name: keyof FormState) => (event: React.FormEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const value = event.currentTarget.value;
    setForm((prev) => ({ ...prev, [name]: value }));
    if (errors[name]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[name];
        return next;
      });
    }
    if (onClearError) {
      onClearError();
    }
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const validation = validateForm(form);
    if (Object.keys(validation).length > 0) {
      setErrors(validation);
      return;
    }

    const payload = toPayload(form);
    await onSubmit(payload);
  };

  const hasError = Object.keys(errors).length > 0;

  return (
    <form className={styles.form} onSubmit={handleSubmit} data-testid="asset-form">
      <div className={styles.grid}>
        <Field
          label="Title"
          required
          error={errors.title}
          invalid={Boolean(errors.title)}
          htmlFor={fieldId('title')}
        >
          <Input id={fieldId('title')} value={form.title} onChange={handleChange('title')} placeholder="Asset title" />
        </Field>
        <Field
          label="Entry date"
          required
          error={errors.entry_date}
          invalid={Boolean(errors.entry_date)}
          htmlFor={fieldId('entry_date')}
        >
          <Input id={fieldId('entry_date')} value={form.entry_date} onChange={handleChange('entry_date')} placeholder="YYYY-MM-DD" />
        </Field>
        <Field
          label="Commissioning date"
          required
          error={errors.commissioning_date}
          invalid={Boolean(errors.commissioning_date)}
          htmlFor={fieldId('commissioning_date')}
        >
          <Input
            id={fieldId('commissioning_date')}
            value={form.commissioning_date}
            onChange={handleChange('commissioning_date')}
            placeholder="YYYY-MM-DD"
          />
        </Field>
        <Field
          label="Station name"
          required
          error={errors.station_name}
          invalid={Boolean(errors.station_name)}
          htmlFor={fieldId('station_name')}
        >
          <Input id={fieldId('station_name')} value={form.station_name} onChange={handleChange('station_name')} />
        </Field>
        <Field
          label="Technician"
          required
          error={errors.technician}
          invalid={Boolean(errors.technician)}
          htmlFor={fieldId('technician')}
        >
          <Input id={fieldId('technician')} value={form.technician} onChange={handleChange('technician')} />
        </Field>
        <Field
          label="Start date"
          required
          error={errors.start_date}
          invalid={Boolean(errors.start_date)}
          htmlFor={fieldId('start_date')}
        >
          <Input id={fieldId('start_date')} value={form.start_date} onChange={handleChange('start_date')} placeholder="YYYY-MM-DD" />
        </Field>
        <Field
          label="End date"
          required
          error={errors.end_date}
          invalid={Boolean(errors.end_date)}
          htmlFor={fieldId('end_date')}
        >
          <Input id={fieldId('end_date')} value={form.end_date} onChange={handleChange('end_date')} placeholder="YYYY-MM-DD" />
        </Field>
        <Field label="Service" htmlFor={fieldId('service')}>
          <Input id={fieldId('service')} value={form.service} onChange={handleChange('service')} />
        </Field>
        <Field
          label="Latitude"
          error={errors.latitude}
          invalid={Boolean(errors.latitude)}
          htmlFor={fieldId('latitude')}
        >
          <Input id={fieldId('latitude')} value={form.latitude} onChange={handleChange('latitude')} placeholder="0" />
        </Field>
        <Field
          label="Longitude"
          error={errors.longitude}
          invalid={Boolean(errors.longitude)}
          htmlFor={fieldId('longitude')}
        >
          <Input id={fieldId('longitude')} value={form.longitude} onChange={handleChange('longitude')} placeholder="0" />
        </Field>
        <Field label="Pitch" error={errors.pitch} invalid={Boolean(errors.pitch)} htmlFor={fieldId('pitch')}>
          <Input id={fieldId('pitch')} value={form.pitch} onChange={handleChange('pitch')} placeholder="0" />
        </Field>
        <Field label="Roll" error={errors.roll} invalid={Boolean(errors.roll)} htmlFor={fieldId('roll')}>
          <Input id={fieldId('roll')} value={form.roll} onChange={handleChange('roll')} placeholder="0" />
        </Field>
      </div>
      <Field label="Staff" description="One person per line" htmlFor={fieldId('staffText')}>
        <TextArea
          id={fieldId('staffText')}
          value={form.staffText}
          onChange={handleChange('staffText')}
          className={styles.staffArea}
        />
      </Field>

      {(errorMessage || hasError) && (
        <Alert title="Unable to submit" severity="error" className={styles.alert}>
          {errorMessage || Object.values(errors)[0]}
        </Alert>
      )}

      <Modal.ButtonRow leftItems={<Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>}>
        <Button type="submit" variant="primary" disabled={isSubmitting}>
          {submitLabel}
        </Button>
      </Modal.ButtonRow>
    </form>
  );
};

function buildFormState(asset?: AssetRecord): FormState {
  return {
    title: asset?.title ?? '',
    entry_date: asset?.entry_date ?? '',
    commissioning_date: asset?.commissioning_date ?? '',
    station_name: asset?.station_name ?? '',
    technician: asset?.technician ?? '',
    start_date: asset?.start_date ?? '',
    end_date: asset?.end_date ?? '',
    service: asset?.service ?? '',
    staffText: asset?.staff?.join('\n') ?? '',
    latitude: asset ? formatNumber(asset.latitude) : '',
    longitude: asset ? formatNumber(asset.longitude) : '',
    pitch: asset ? formatNumber(asset.pitch) : '',
    roll: asset ? formatNumber(asset.roll) : '',
  };
}

function formatNumber(value: number): string {
  return String(value);
}

function toPayload(form: FormState): AssetPayload {
  return {
    title: form.title.trim(),
    entry_date: form.entry_date.trim(),
    commissioning_date: form.commissioning_date.trim(),
    station_name: form.station_name.trim(),
    technician: form.technician.trim(),
    start_date: form.start_date.trim(),
    end_date: form.end_date.trim(),
    service: form.service.trim() || undefined,
    staff: form.staffText
      .split(/\r?\n/)
      .map((member) => member.trim())
      .filter((member) => member.length > 0),
    latitude: parseNumber(form.latitude),
    longitude: parseNumber(form.longitude),
    pitch: parseNumber(form.pitch),
    roll: parseNumber(form.roll),
  };
}

function validateForm(form: FormState): FormErrors {
  const errors: FormErrors = {};
  if (!form.title.trim()) {
    errors.title = 'Title is required';
  }
  if (!form.entry_date.trim()) {
    errors.entry_date = 'Entry date is required';
  }
  if (!form.commissioning_date.trim()) {
    errors.commissioning_date = 'Commissioning date is required';
  }
  if (!form.station_name.trim()) {
    errors.station_name = 'Station name is required';
  }
  if (!form.technician.trim()) {
    errors.technician = 'Technician is required';
  }
  if (!form.start_date.trim()) {
    errors.start_date = 'Start date is required';
  }
  if (!form.end_date.trim()) {
    errors.end_date = 'End date is required';
  }

  ['latitude', 'longitude', 'pitch', 'roll'].forEach((key) => {
    const value = form[key as keyof FormState];
    if (value.trim() === '') {
      return;
    }
    const numeric = Number(value);
    if (Number.isNaN(numeric)) {
      errors[key as keyof FormState] = 'Must be a number';
    }
  });

  return errors;
}

function parseNumber(value: string): number {
  if (value.trim() === '') {
    return 0;
  }
  const numeric = Number(value);
  if (Number.isNaN(numeric)) {
    return 0;
  }
  return numeric;
}

const getStyles = (theme: GrafanaTheme2) => ({
  form: css`
    display: flex;
    flex-direction: column;
    gap: ${theme.spacing(2)};
  `,
  grid: css`
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: ${theme.spacing(2)};
  `,
  staffArea: css`
    min-height: 100px;
  `,
  alert: css`
    margin-top: ${theme.spacing(1)};
  `,
});

export default AssetForm;
