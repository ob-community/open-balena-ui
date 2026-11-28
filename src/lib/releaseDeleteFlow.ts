export interface ReleaseDeleteFlow {
  /** Performs the deletion (single release or bulk). */
  performDelete: () => Promise<unknown>;
  notifySuccess: () => void;
  notifyFailure: (message: string) => void;
  /**
   * Steps to run after a successful delete (unselect, refresh, redirect). A failure here is logged,
   * never reported as a failed delete: the releases are already gone at this point.
   */
  afterSuccess: Array<() => void>;
}

/** Runs a release delete and its follow-up steps. Resolves to true when the delete succeeded. */
export const runReleaseDelete = async ({
  performDelete,
  notifySuccess,
  notifyFailure,
  afterSuccess,
}: ReleaseDeleteFlow): Promise<boolean> => {
  try {
    await performDelete();
  } catch (error) {
    notifyFailure(error instanceof Error ? error.message : 'Unknown error');
    return false;
  }

  notifySuccess();
  for (const step of afterSuccess) {
    try {
      step();
    } catch (error) {
      console.error('Release(s) deleted, but a follow-up step failed:', error);
    }
  }
  return true;
};
