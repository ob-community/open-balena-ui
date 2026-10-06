import React, { useId, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  InputAdornment,
  MenuItem,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import CloseIcon from '@mui/icons-material/Close';
import SearchIcon from '@mui/icons-material/Search';
import {
  localLogTimestampToIso,
  messageLogOperators,
  parseLogFilterTimestamp,
  timestampLogOperators,
  validateLogFilterClause,
  validateLogFilters,
} from '../lib/deviceLogFilters';
import type { LogFilterClause, LogFilterGroup } from '../lib/deviceLogFilters';

export interface DeviceLogFiltersProps {
  search: string;
  onSearchChange: (value: string) => void;
  filters: LogFilterGroup[];
  onFiltersChange: (filters: LogFilterGroup[]) => void;
}

interface DraftClause {
  id: string;
  field: LogFilterClause['field'];
  operator: LogFilterClause['operator'];
  value: string;
}

const smallFieldSx = {
  '& .MuiInputBase-root.MuiOutlinedInput-root': { fontSize: '0.875rem', height: 36 },
  '& input.MuiInputBase-input': { fontSize: '0.875rem', py: '8px', px: '12px' },
  '& .MuiSelect-select': { fontSize: '0.875rem', py: '8px', pl: '12px', pr: '32px' },
  '& .MuiInputLabel-root': { fontSize: '0.875rem' },
};

function localTimestamp(iso: string): string {
  const instant = parseLogFilterTimestamp(iso);
  if (instant === undefined) return iso;
  const date = new Date(instant);
  const pad = (value: number, length = 2) => String(value).padStart(length, '0');
  return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
}

function submittedClause(row: DraftClause): LogFilterClause | undefined {
  if (row.field === 'timestamp') {
    const value = localLogTimestampToIso(row.value);
    if (!value || !(timestampLogOperators as readonly string[]).includes(row.operator)) return undefined;
    return { ...row, field: 'timestamp', operator: row.operator as (typeof timestampLogOperators)[number], value };
  }
  if (!(messageLogOperators as readonly string[]).includes(row.operator)) return undefined;
  return { ...row, field: 'message', operator: row.operator as (typeof messageLogOperators)[number] };
}

function rowError(row: DraftClause): string | undefined {
  const clause = submittedClause(row);
  return clause ? validateLogFilterClause(clause) : 'Enter a valid date and time (local time).';
}

export const DeviceLogFilters: React.FC<DeviceLogFiltersProps> = ({
  search,
  onSearchChange,
  filters,
  onFiltersChange,
}) => {
  const prefix = useId();
  const counter = useRef(0);
  const nextId = () => `${prefix}-${++counter.current}`;
  const [draft, setDraft] = useState<LogFilterGroup | null>(null);
  const [rows, setRows] = useState<DraftClause[]>([]);
  const [submitted, setSubmitted] = useState(false);
  const activeErrors = validateLogFilters(filters);
  const newRow = (): DraftClause => ({ id: nextId(), field: 'message', operator: 'contains', value: '' });

  const openFilter = (group?: LogFilterGroup) => {
    setDraft(group ?? { id: nextId(), alternatives: [] });
    setRows(
      group
        ? group.alternatives.map((clause) => ({
            ...clause,
            value: clause.field === 'timestamp' ? localTimestamp(clause.value) : clause.value,
          }))
        : [newRow()],
    );
    setSubmitted(false);
  };
  const updateRow = (id: string, update: Partial<DraftClause>) => {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...update } : row)));
  };
  const close = () => setDraft(null);
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (!draft || !rows.length || rows.some((row) => rowError(row))) return;
    const group: LogFilterGroup = { id: draft.id, alternatives: rows.map((row) => submittedClause(row)!) };
    onFiltersChange(
      filters.some(({ id }) => id === group.id)
        ? filters.map((filter) => (filter.id === group.id ? group : filter))
        : [...filters, group],
    );
    close();
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'flex-end' }}>
        <TextField
          size='small'
          label='Search logs'
          placeholder='Search messages'
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          sx={{ ...smallFieldSx, flex: '1 1 200px', minWidth: 160 }}
          InputProps={{
            startAdornment: (
              <InputAdornment position='start'>
                <SearchIcon fontSize='small' />
              </InputAdornment>
            ),
            endAdornment: search ? (
              <InputAdornment position='end'>
                <IconButton
                  aria-label='Clear log search'
                  size='small'
                  onClick={() => onSearchChange('')}
                  sx={{ p: 0.5 }}
                >
                  <CloseIcon fontSize='small' />
                </IconButton>
              </InputAdornment>
            ) : undefined,
          }}
        />
        <Button
          size='small'
          variant='outlined'
          startIcon={<AddIcon fontSize='small' />}
          onClick={() => openFilter()}
          sx={{ fontSize: '0.8125rem', minHeight: 36, px: 1.5, py: 0.5 }}
        >
          Add filter
        </Button>
      </Box>
      {filters.length > 0 && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, alignItems: 'center' }}>
          {filters.map((group, index) => {
            const label = group.alternatives
              .map(
                (clause) =>
                  `${clause.field === 'message' ? 'Message' : 'Timestamp'} ${clause.operator} "${clause.value}"`,
              )
              .join(' OR ');
            return (
              <React.Fragment key={group.id}>
                {index > 0 && <Typography variant='caption'>AND</Typography>}
                <Tooltip title={`Edit filter: ${label}`}>
                  <Chip
                    size='small'
                    label={label || 'Invalid empty filter'}
                    onClick={() => openFilter(group)}
                    onDelete={() => onFiltersChange(filters.filter(({ id }) => id !== group.id))}
                    sx={{
                      'maxWidth': '100%',
                      'height': 28,
                      'fontSize': '0.75rem',
                      '& .MuiChip-label': { overflow: 'hidden', textOverflow: 'ellipsis' },
                    }}
                  />
                </Tooltip>
              </React.Fragment>
            );
          })}
        </Box>
      )}
      {activeErrors.length > 0 && (
        <Alert severity='error' sx={{ py: 0, fontSize: '0.8125rem' }}>
          {activeErrors.join(' ')}
        </Alert>
      )}
      <Dialog open={draft !== null} onClose={close} fullWidth maxWidth='md' aria-labelledby={`${prefix}-title`}>
        <Box component='form' noValidate onSubmit={submit}>
          <DialogTitle id={`${prefix}-title`} sx={{ fontSize: '1.125rem', py: 1.5 }}>
            Filter by
          </DialogTitle>
          <DialogContent sx={{ pt: '8px !important' }}>
            <Typography variant='body2' sx={{ mb: 2, fontSize: '0.8125rem' }}>
              Alternatives match with OR. Separate filters and search match with AND. Message matching ignores case.
            </Typography>
            {rows.map((row, index) => {
              const error = submitted ? rowError(row) : undefined;
              return (
                <Box key={row.id} sx={{ mb: 1.5 }}>
                  {index > 0 && (
                    <Typography variant='caption' sx={{ display: 'block', mb: 1 }}>
                      OR
                    </Typography>
                  )}
                  <Box
                    sx={{
                      display: 'grid',
                      gridTemplateColumns: { xs: '1fr 32px', sm: '130px 180px minmax(0, 1fr) 32px' },
                      gap: 1,
                      alignItems: 'start',
                    }}
                  >
                    <TextField
                      select
                      size='small'
                      SelectProps={{ size: 'small' }}
                      label='Field'
                      value={row.field}
                      sx={{ ...smallFieldSx, gridColumn: { xs: '1', sm: 'auto' } }}
                      onChange={(event) => {
                        const field = event.target.value as LogFilterClause['field'];
                        updateRow(row.id, { field, operator: field === 'message' ? 'contains' : 'after', value: '' });
                      }}
                    >
                      <MenuItem value='message' sx={{ fontSize: '0.875rem', py: '6px !important' }}>
                        Message
                      </MenuItem>
                      <MenuItem value='timestamp' sx={{ fontSize: '0.875rem', py: '6px !important' }}>
                        Timestamp
                      </MenuItem>
                    </TextField>
                    <TextField
                      select
                      size='small'
                      SelectProps={{ size: 'small' }}
                      label='Operator'
                      value={row.operator}
                      sx={{ ...smallFieldSx, gridColumn: { xs: '1', sm: 'auto' } }}
                      onChange={(event) =>
                        updateRow(row.id, { operator: event.target.value as LogFilterClause['operator'] })
                      }
                    >
                      {(row.field === 'message' ? messageLogOperators : timestampLogOperators).map((operator) => (
                        <MenuItem key={operator} value={operator} sx={{ fontSize: '0.875rem', py: '6px !important' }}>
                          {operator}
                        </MenuItem>
                      ))}
                    </TextField>
                    <TextField
                      size='small'
                      label={row.field === 'timestamp' ? 'Value (local time)' : 'Value'}
                      type={row.field === 'timestamp' ? 'datetime-local' : 'text'}
                      value={row.value}
                      onChange={(event) => updateRow(row.id, { value: event.target.value })}
                      error={Boolean(error)}
                      helperText={
                        error ??
                        (row.field === 'timestamp'
                          ? 'Local time; saved as ISO. “Is” matches the exact instant.'
                          : undefined)
                      }
                      InputLabelProps={row.field === 'timestamp' ? { shrink: true } : undefined}
                      inputProps={row.field === 'timestamp' ? { step: '0.001' } : undefined}
                      sx={{ ...smallFieldSx, minWidth: 0, gridColumn: { xs: '1', sm: 'auto' } }}
                    />
                    <Tooltip title='Remove alternative'>
                      <Box
                        component='span'
                        sx={{ gridColumn: { xs: '2', sm: 'auto' }, gridRow: { xs: '1', sm: 'auto' } }}
                      >
                        <IconButton
                          size='small'
                          aria-label={`Remove alternative ${index + 1}`}
                          disabled={rows.length === 1}
                          onClick={() => setRows((current) => current.filter(({ id }) => id !== row.id))}
                          sx={{ p: 0.5 }}
                        >
                          <CloseIcon fontSize='small' />
                        </IconButton>
                      </Box>
                    </Tooltip>
                  </Box>
                </Box>
              );
            })}
            {submitted && !rows.length && <Alert severity='error'>Add at least one condition.</Alert>}
            <Button
              size='small'
              startIcon={<AddIcon fontSize='small' />}
              onClick={() => setRows((current) => [...current, newRow()])}
              sx={{ fontSize: '0.8125rem', py: 0.5 }}
            >
              Add alternative
            </Button>
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 2 }}>
            <Button size='small' onClick={close} sx={{ fontSize: '0.8125rem', py: 0.5 }}>
              Cancel
            </Button>
            <Button size='small' type='submit' variant='contained' sx={{ fontSize: '0.8125rem', py: 0.5 }}>
              Submit
            </Button>
          </DialogActions>
        </Box>
      </Dialog>
    </Box>
  );
};

export default DeviceLogFilters;
