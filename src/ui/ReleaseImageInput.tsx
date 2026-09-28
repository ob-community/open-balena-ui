import * as React from 'react';
import { AutocompleteInput, ReferenceInput, required, type RaRecord } from 'react-admin';

const formatReleaseImage = (record: RaRecord): string =>
  `#${record.id} - image ${record.image} / release ${record['is part of-release']}`;

const filterReleaseImages = (searchText: string): Record<string, number> => {
  const id = Number(searchText.trim().replace(/^#/, ''));
  return Number.isInteger(id) && id > 0 ? { '#id,image,is part of-release@eq': id } : {};
};

const ReleaseImageInput: React.FC = () => (
  <ReferenceInput
    source='release image'
    reference='image-is part of-release'
    perPage={25}
    sort={{ field: 'id', order: 'DESC' }}
  >
    <AutocompleteInput
      label='Release Image'
      optionText={formatReleaseImage}
      optionValue='id'
      filterToQuery={filterReleaseImages}
      validate={required()}
      fullWidth
    />
  </ReferenceInput>
);

export default ReleaseImageInput;
