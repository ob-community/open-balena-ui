import type { RaRecord } from 'ra-core';

declare module 'ra-ui-materialui/dist/cjs/field/ReferenceField' {
  interface ReferenceFieldProps<
    RecordType extends Record<string, any> = Record<string, any>,
    ReferenceRecordType extends RaRecord = RaRecord,
  > {
    target?: string;
  }
}

declare module 'ra-ui-materialui/dist/cjs/field/ReferenceFieldView' {
  interface ReferenceFieldViewProps<
    RecordType extends Record<string, any> = Record<string, any>,
    ReferenceRecordType extends RaRecord = RaRecord,
  > {
    target?: string;
  }
}

declare module 'ra-ui-materialui/dist/esm/field/ReferenceField' {
  interface ReferenceFieldProps<
    RecordType extends Record<string, any> = Record<string, any>,
    ReferenceRecordType extends RaRecord = RaRecord,
  > {
    target?: string;
  }
}

declare module 'ra-ui-materialui/dist/esm/field/ReferenceFieldView' {
  interface ReferenceFieldViewProps<
    RecordType extends Record<string, any> = Record<string, any>,
    ReferenceRecordType extends RaRecord = RaRecord,
  > {
    target?: string;
  }
}
