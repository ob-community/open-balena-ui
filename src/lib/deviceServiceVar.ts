export function useCreateDeviceServiceVar() {
  return async (data) => {
    // delete unused field
    delete data.device;
    return data;
  };
}

export function useModifyDeviceServiceVar() {
  return async (data) => {
    // delete unused field
    delete data.device;
    return data;
  };
}
