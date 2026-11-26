import * as React from 'react';
import { CreateButton, ExportButton, TopToolbar, useLocation } from 'react-admin';

// Lists embedded in another page (e.g. the device detail tabs) link to the global edit/create pages.
// The origin travels in the router state so that saving returns there instead of to the global list.
// ponytail: an edit/create URL opened directly has no origin and falls back to the global list.
export const useReturnState = () => ({ returnTo: useLocation().pathname });

export const useReturnTo = () => {
  const returnTo = (useLocation().state as { returnTo?: string } | null)?.returnTo;
  return returnTo ? () => returnTo : ('list' as const);
};

// `record` prefills the create form, e.g. { device: 3 } when the list is embedded in a device page.
export const ReturnListActions: React.FC<{ record?: object }> = ({ record }) => (
  <TopToolbar>
    <CreateButton state={{ ...useReturnState(), record }} />
    <ExportButton />
  </TopToolbar>
);
