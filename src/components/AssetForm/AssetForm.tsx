import React, { ComponentProps, FormEvent, useEffect, useId, useMemo, useState } from 'react';
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

type InputProps = ComponentProps<typeof Input>;

type FieldConfig = {
  name: Exclude<keyof FormState, 'staffText'>;
  label: string;
  required?: boolean;
  placeholder?: string;
  type?: InputProps['type'];
  inputMode?: InputProps['inputMode'];
  step?: InputProps['step'];
};

const formFieldSchema: FieldConfig[] = [
  { name: 'title', label: 'Title', required: true, placeholder: 'Asset title', type: 'text' },
  { name: 'entry_date', label: 'Entry date', required: true, type: 'date', placeholder: 'YYYY-MM-DD' },
  { name: 'commissioning_date', label: 'Commissioning date', required: true, type: 'date', placeholder: 'YYYY-MM-DD' },
  { name: 'station_name', label: 'Station name', required: true, type: 'text' },
  { name: 'technician', label: 'Technician', required: true, type: 'text' },
  { name: 'start_date', label: 'Start date', required: true, type: 'date', placeholder: 'YYYY-MM-DD' },
  { name: 'end_date', label: 'End date', required: true, type: 'date', placeholder: 'YYYY-MM-DD' },
  { name: 'service', label: 'Service', type: 'text' },
  {
    name: 'latitude',
    label: 'Latitude',
    placeholder: '0',
    type: 'number',
    inputMode: 'decimal',
    step: 'any',
  },
  {
    name: 'longitude',
    label: 'Longitude',
    placeholder: '0',
    type: 'number',
    inputMode: 'decimal',
    step: 'any',
  },
  { name: 'pitch', label: 'Pitch', placeholder: '0', type: 'number', inputMode: 'decimal', step: 'any' },
  { name: 'roll', label: 'Roll', placeholder: '0', type: 'number', inputMode: 'decimal', step: 'any' },
];

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
        {formFieldSchema.map(({ name, label, required, placeholder, type, inputMode, step }) => {
          const error = errors[name];
          return (
            <Field
              key={name}
              label={label}
              required={required}
              error={error}
              invalid={Boolean(error)}
              htmlFor={fieldId(name)}
            >
              <Input
                id={fieldId(name)}
                value={form[name]}
                onChange={handleChange(name)}
                placeholder={placeholder}
                type={type}
                inputMode={inputMode}
                step={step}
              />
            </Field>
          );
        })}
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
    entry_date: formatDateValue(asset?.entry_date),
    commissioning_date: formatDateValue(asset?.commissioning_date),
    station_name: asset?.station_name ?? '',
    technician: asset?.technician ?? '',
    start_date: formatDateValue(asset?.start_date),
    end_date: formatDateValue(asset?.end_date),
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

function formatDateValue(value?: string): string {
  if (!value) {
    return '';
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }

  const isoMatch = trimmed.match(/^(\d{4}-\d{2}-\d{2})/);
  if (isoMatch) {
    return isoMatch[1];
  }

  const parsedTimestamp = Date.parse(trimmed);
  if (!Number.isNaN(parsedTimestamp)) {
    return new Date(parsedTimestamp).toISOString().slice(0, 10);
  }

  return trimmed;
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
