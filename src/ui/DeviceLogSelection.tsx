import React from 'react';
import { deviceLogServiceEvent, type DeviceLogServiceSelection } from '../lib/deviceServicePresentation';

interface LogSelection {
  selected: DeviceLogServiceSelection[];
  setSelected: React.Dispatch<React.SetStateAction<DeviceLogServiceSelection[]>>;
  toggle: (selection: DeviceLogServiceSelection) => void;
}
const SelectionContext = React.createContext<LogSelection | undefined>(undefined);

export const DeviceLogSelectionProvider: React.FC<React.PropsWithChildren<{ deviceId: number | string }>> = ({
  deviceId,
  children,
}) => {
  const [selected, setSelected] = React.useState<DeviceLogServiceSelection[]>([]);
  const toggle = React.useCallback((selection: DeviceLogServiceSelection) => {
    setSelected((current) =>
      current.some(({ serviceId }) => serviceId === selection.serviceId)
        ? current.filter(({ serviceId }) => serviceId !== selection.serviceId)
        : [...current, selection],
    );
  }, []);
  React.useEffect(() => {
    const listener = (event: Event) => {
      const selection = (event as CustomEvent<DeviceLogServiceSelection>).detail;
      if (selection.deviceId != null && String(selection.deviceId) !== String(deviceId)) return;
      toggle(selection);
    };
    window.addEventListener(deviceLogServiceEvent, listener);
    return () => window.removeEventListener(deviceLogServiceEvent, listener);
  }, [deviceId, toggle]);
  const value = React.useMemo(() => ({ selected, setSelected, toggle }), [selected, toggle]);
  return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>;
};

export const useDeviceLogSelection = (): LogSelection => {
  const selection = React.useContext(SelectionContext);
  if (!selection) throw new Error('Device log controls require a device log selection provider.');
  return selection;
};
