import Box from '@mui/material/Box';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import * as React from 'react';
import { AutocompleteInput, ReferenceInput, useListContext } from 'react-admin';

const actorTypeOptions = [
  { id: 'user', name: 'User', reference: 'user', optionText: 'username' },
  { id: 'device', name: 'Device', reference: 'device', optionText: 'device name' },
  { id: 'fleet', name: 'Fleet', reference: 'application', optionText: 'app name' },
] as const;

type ActorType = (typeof actorTypeOptions)[number]['id'] | '';

export interface ActorFilterProps {
  /** The source field to filter on (defaults to 'is of-actor') */
  source?: string;
  /** Label for the type selector (defaults to 'Assigned To') */
  label?: string;
  /** Whether this filter should always be visible */
  alwaysOn?: boolean;
}

const ActorFilter: React.FC<ActorFilterProps> = ({ source = 'is of-actor', label = 'Assigned To' }) => {
  const [actorType, setActorType] = React.useState<ActorType>('');
  const { filterValues, setFilters } = useListContext();

  const handleTypeChange = (newType: ActorType) => {
    setActorType(newType);
    // Clear the actor filter when type changes
    const { [source]: _, ...restFilters } = filterValues;
    setFilters(restFilters, undefined);
  };

  const selectedTypeConfig = actorTypeOptions.find((opt) => opt.id === actorType);

  return (
    <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-end' }}>
      <FormControl size='small' sx={{ minWidth: 120 }}>
        <InputLabel id='actor-type-label'>{label}</InputLabel>
        <Select
          labelId='actor-type-label'
          value={actorType}
          label={label}
          onChange={(e) => handleTypeChange(e.target.value as ActorType)}
        >
          <MenuItem value=''>
            <em>Any</em>
          </MenuItem>
          {actorTypeOptions.map((opt) => (
            <MenuItem key={opt.id} value={opt.id}>
              {opt.name}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
      {selectedTypeConfig && (
        <ReferenceInput source={source} reference={selectedTypeConfig.reference}>
          <AutocompleteInput
            optionText={selectedTypeConfig.optionText}
            optionValue='actor'
            label={`Select ${selectedTypeConfig.name}`}
            sx={{ minWidth: 200 }}
          />
        </ReferenceInput>
      )}
    </Box>
  );
};

export default ActorFilter;

