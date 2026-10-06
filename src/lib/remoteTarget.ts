export type ContainerKind = 'service' | 'supervisor';

export interface ContainerSelector {
  container: string;
  containerKind: ContainerKind;
}

export type RemoteTargetSelection =
  { target: 'host'; container?: never; containerKind?: never } | ({ target: 'container' } & ContainerSelector);

export const isContainerName = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(value);

export const parseContainerSelector = (container: unknown, containerKind?: unknown): ContainerSelector => {
  if (!isContainerName(container)) throw new Error('Invalid container name.');
  // Legacy clients reserved this name for Supervisor; explicit service selectors never do.
  const kind =
    containerKind === undefined ? (container === 'balena_supervisor' ? 'supervisor' : 'service') : containerKind;
  if (kind !== 'service' && kind !== 'supervisor') throw new Error('Invalid container kind.');
  if (kind === 'supervisor' && container !== 'balena_supervisor')
    throw new Error('The Supervisor selector requires balena_supervisor.');
  return { container, containerKind: kind };
};

export const parseRemoteTarget = (
  target: unknown,
  container: unknown,
  containerKind?: unknown,
): RemoteTargetSelection => {
  if (target === 'host') {
    if (container !== undefined || containerKind !== undefined)
      throw new Error('Host targets cannot specify a container or container kind.');
    return { target: 'host' };
  }
  if (target !== 'container') throw new Error('Invalid remote target.');
  return { target: 'container', ...parseContainerSelector(container, containerKind) };
};

export const normalizeContainerSelector = (selector: ContainerSelector | string): ContainerSelector =>
  typeof selector === 'string'
    ? parseContainerSelector(selector)
    : parseContainerSelector(selector.container, selector.containerKind);
