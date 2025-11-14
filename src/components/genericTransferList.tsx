// src/components/genericTransferList.tsx
import React from 'react';
import KeyboardArrowLeftIcon from '@mui/icons-material/KeyboardArrowLeft';
import KeyboardArrowRightIcon from '@mui/icons-material/KeyboardArrowRight';
import KeyboardDoubleArrowLeftIcon from '@mui/icons-material/KeyboardDoubleArrowLeft';
import KeyboardDoubleArrowRightIcon from '@mui/icons-material/KeyboardDoubleArrowRight';
import {
  Box,
  Button,
  List,
  ListItemButton,
  ListItemText,
  ListSubheader,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';
import type { Identifier } from 'react-admin';

export interface TransferListOption {
  id: Identifier;
  label: string;
  group?: string;
  [key: string]: any; // Allow arbitrary props (for verb/predicate)
}

export interface GenericTransferListProps {
  options: TransferListOption[];
  value: Identifier[];
  onChange: (nextValue: Identifier[]) => void;
  availableLabel?: React.ReactNode;
  selectedLabel?: React.ReactNode;
  listWidth?: number;
  listHeight?: number;
  disabled?: boolean;
  sx?: SxProps<Theme>;

  /** Optional custom renderer for each row (e.g., to inject a Tooltip). */
  renderOption?: (opt: TransferListOption) => React.ReactNode;

  /** Callback for when a list is scrolled */
  onListScroll?: () => void;
}

const NO_GROUP_KEY = '__no_group__';

const groupOptions = (items: TransferListOption[], collator: Intl.Collator) => {
  const grouped = new Map<string, TransferListOption[]>();

  items.forEach((item) => {
    const key = item.group ?? NO_GROUP_KEY;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(item);
  });

  const sortedGroups = Array.from(grouped.entries())
    .map(([key, groupItems]) => [key, [...groupItems].sort((a, b) => collator.compare(a.label, b.label))] as const)
    .sort((a, b) => {
      const aKey = a[0] === NO_GROUP_KEY ? '' : a[0];
      const bKey = b[0] === NO_GROUP_KEY ? '' : b[0];
      return collator.compare(aKey, bKey);
    });

  return sortedGroups;
};

const intersection = (a: Identifier[], b: Set<Identifier>) => a.filter((id) => b.has(id));

type SelectionComputationArgs = {
  id: Identifier;
  items: TransferListOption[];
  currentSelection: Identifier[];
  currentAnchor: Identifier | null;
  modifiers: { isCtrl: boolean; isShift: boolean };
};

const orderSelectionByItems = (ids: Identifier[], items: TransferListOption[]) => {
  const indexMap = new Map<Identifier, number>();
  items.forEach((item, index) => indexMap.set(item.id, index));
  const uniqueIds = Array.from(new Set(ids));
  uniqueIds.sort((a, b) => {
    const aIndex = indexMap.get(a) ?? Number.MAX_SAFE_INTEGER;
    const bIndex = indexMap.get(b) ?? Number.MAX_SAFE_INTEGER;
    return aIndex - bIndex;
  });
  return uniqueIds;
};

const computeNextSelection = ({ id, items, currentSelection, currentAnchor, modifiers }: SelectionComputationArgs) => {
  const indexMap = new Map<Identifier, number>();
  items.forEach((item, index) => indexMap.set(item.id, index));

  const targetIndex = indexMap.get(id);
  if (targetIndex == null) return { selection: currentSelection, anchor: currentAnchor };

  const { isCtrl, isShift } = modifiers;
  let nextAnchor = currentAnchor;

  const ensureValidAnchor = () => {
    if (nextAnchor == null || !indexMap.has(nextAnchor)) nextAnchor = id;
  };

  if (!isCtrl && !isShift) {
    nextAnchor = id;
    return { selection: [id], anchor: nextAnchor };
  }

  if (isShift) {
    ensureValidAnchor();
    const anchorIndex = nextAnchor != null ? (indexMap.get(nextAnchor) ?? targetIndex) : targetIndex;
    const start = Math.min(anchorIndex!, targetIndex);
    const end = Math.max(anchorIndex!, targetIndex);
    const range = items.slice(start, end + 1).map((item) => item.id);
    if (isCtrl) {
      const merged = new Set(currentSelection);
      range.forEach((rangeId) => merged.add(rangeId));
      return { selection: orderSelectionByItems(Array.from(merged), items), anchor: nextAnchor };
    }
    return { selection: range, anchor: nextAnchor };
  }

  // Ctrl only (toggle)
  nextAnchor = id;
  if (currentSelection.includes(id)) {
    return {
      selection: orderSelectionByItems(
        currentSelection.filter((selectedId) => selectedId !== id),
        items,
      ),
      anchor: nextAnchor,
    };
  }
  return {
    selection: orderSelectionByItems([...currentSelection, id], items),
    anchor: nextAnchor,
  };
};

const focusListItem = (list: React.RefObject<HTMLUListElement | null>, index: number) => {
  if (!list.current) return;
  const target = list.current.querySelector<HTMLElement>(`[data-index="${index}"]`);
  target?.focus();
};

export const GenericTransferList: React.FC<GenericTransferListProps> = ({
  options,
  value,
  onChange,
  availableLabel = 'Available',
  selectedLabel = 'Selected',
  listWidth = 280,
  listHeight = 320,
  disabled = false,
  sx,
  renderOption,
  onListScroll, // <-- Destructure prop
}) => {
  const collator = React.useMemo(() => new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }), []);

  const sortOptions = React.useCallback(
    (items: TransferListOption[]) => {
      const sorted = [...items].sort((a, b) => {
        const groupA = a.group ?? '';
        const groupB = b.group ?? '';
        const groupCompare = collator.compare(groupA, groupB);
        if (groupCompare !== 0) return groupCompare;
        // Use label for sorting if it exists, otherwise fall back
        const labelA = a.label || (a as any).verb || '';
        const labelB = b.label || (b as any).verb || '';
        return collator.compare(labelA, labelB);
      });
      return sorted;
    },
    [collator],
  );

  const optionMap = React.useMemo(() => {
    const map = new Map<Identifier, TransferListOption>();
    options.forEach((option) => map.set(option.id, option));
    return map;
  }, [options]);

  const valueSet = React.useMemo(() => new Set<Identifier>(value), [value]);

  const availableItems = React.useMemo(
    () => sortOptions(options.filter((option) => !valueSet.has(option.id))),
    [options, sortOptions, valueSet],
  );

  const selectedItems = React.useMemo(
    () => sortOptions(value.map((id) => optionMap.get(id)).filter((o): o is TransferListOption => Boolean(o))),
    [optionMap, sortOptions, value],
  );

  const availableIdSet = React.useMemo(() => new Set<Identifier>(availableItems.map((i) => i.id)), [availableItems]);
  const selectedIdSet = React.useMemo(() => new Set<Identifier>(selectedItems.map((i) => i.id)), [selectedItems]);

  const [availableSelection, setAvailableSelection] = React.useState<Identifier[]>([]);
  const [selectedSelection, setSelectedSelection] = React.useState<Identifier[]>([]);

  const availableAnchorRef = React.useRef<Identifier | null>(null);
  const selectedAnchorRef = React.useRef<Identifier | null>(null);

  const availableListRef = React.useRef<HTMLUListElement | null>(null);
  const selectedListRef = React.useRef<HTMLUListElement | null>(null);

  const availableCheckedSet = React.useMemo(() => new Set<Identifier>(availableSelection), [availableSelection]);
  const selectedCheckedSet = React.useMemo(() => new Set<Identifier>(selectedSelection), [selectedSelection]);

  const baseListId = React.useId();

  React.useEffect(() => {
    setAvailableSelection((current) => intersection(current, availableIdSet));
  }, [availableIdSet]);

  React.useEffect(() => {
    setSelectedSelection((current) => intersection(current, selectedIdSet));
  }, [selectedIdSet]);

  const handleAvailableClick = React.useCallback(
    (event: React.MouseEvent<HTMLDivElement>, id: Identifier) => {
      if (disabled) return;
      const isCtrl = event.ctrlKey || event.metaKey;
      const isShift = event.shiftKey;

      setAvailableSelection((current) => {
        const { selection, anchor } = computeNextSelection({
          id,
          items: availableItems,
          currentSelection: current,
          currentAnchor: availableAnchorRef.current,
          modifiers: { isCtrl, isShift },
        });
        availableAnchorRef.current = anchor;
        return selection;
      });
    },
    [availableItems, disabled],
  );

  const handleSelectedClick = React.useCallback(
    (event: React.MouseEvent<HTMLDivElement>, id: Identifier) => {
      if (disabled) return;
      const isCtrl = event.ctrlKey || event.metaKey;
      const isShift = event.shiftKey;

      setSelectedSelection((current) => {
        const { selection, anchor } = computeNextSelection({
          id,
          items: selectedItems,
          currentSelection: current,
          currentAnchor: selectedAnchorRef.current,
          modifiers: { isCtrl, isShift },
        });
        selectedAnchorRef.current = anchor;
        return selection;
      });
    },
    [disabled, selectedItems],
  );

  const handleArrowNavigation = React.useCallback(
    (
      direction: 'up' | 'down' | 'home' | 'end',
      id: Identifier,
      items: TransferListOption[],
      listRef: React.RefObject<HTMLUListElement | null>,
      setSelection: React.Dispatch<React.SetStateAction<Identifier[]>>,
      anchorRef: React.MutableRefObject<Identifier | null>,
      event: React.KeyboardEvent<HTMLDivElement>,
    ) => {
      if (items.length === 0) return;
      const currentIndex = items.findIndex((item) => item.id === id);
      if (currentIndex === -1) return;

      let nextIndex = currentIndex;
      if (direction === 'up') nextIndex = Math.max(0, currentIndex - 1);
      else if (direction === 'down') nextIndex = Math.min(items.length - 1, currentIndex + 1);
      else if (direction === 'home') nextIndex = 0;
      else nextIndex = items.length - 1;

      if (nextIndex === currentIndex) return;

      focusListItem(listRef, nextIndex);
      const nextId = items[nextIndex].id;
      const isCtrl = event.ctrlKey || event.metaKey;
      const isShift = event.shiftKey;

      setSelection((current) => {
        if (isCtrl && !isShift) return current;

        const fallbackAnchor = anchorRef.current ?? id;
        const { selection, anchor } = computeNextSelection({
          id: nextId,
          items,
          currentSelection: current,
          currentAnchor: isShift ? fallbackAnchor : null,
          modifiers: { isCtrl, isShift },
        });
        anchorRef.current = isShift ? anchor : nextId;
        return selection;
      });
    },
    [],
  );

  const handleAvailableKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>, id: Identifier) => {
      if (disabled) return;
      const key = event.key;

      if (key === ' ' || key === 'Enter') {
        event.preventDefault();
        const isCtrl = event.ctrlKey || event.metaKey;
        const isShift = event.shiftKey;

        setAvailableSelection((current) => {
          const { selection, anchor } = computeNextSelection({
            id,
            items: availableItems,
            currentSelection: current,
            currentAnchor: availableAnchorRef.current,
            modifiers: { isCtrl, isShift },
          });
          availableAnchorRef.current = anchor;
          return selection;
        });
        return;
      }

      if (key === 'ArrowUp' || key === 'ArrowDown' || key === 'Home' || key === 'End') {
        event.preventDefault();
        handleArrowNavigation(
          key === 'ArrowUp' ? 'up' : key === 'ArrowDown' ? 'down' : key === 'Home' ? 'home' : 'end',
          id,
          availableItems,
          availableListRef,
          setAvailableSelection,
          availableAnchorRef,
          event,
        );
      }
    },
    [availableItems, disabled, handleArrowNavigation],
  );

  const handleSelectedKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>, id: Identifier) => {
      if (disabled) return;
      const key = event.key;

      if (key === ' ' || key === 'Enter') {
        event.preventDefault();
        const isCtrl = event.ctrlKey || event.metaKey;
        const isShift = event.shiftKey;

        setSelectedSelection((current) => {
          const { selection, anchor } = computeNextSelection({
            id,
            items: selectedItems,
            currentSelection: current,
            currentAnchor: selectedAnchorRef.current,
            modifiers: { isCtrl, isShift },
          });
          selectedAnchorRef.current = anchor;
          return selection;
        });
        return;
      }

      if (key === 'ArrowUp' || key === 'ArrowDown' || key === 'Home' || key === 'End') {
        event.preventDefault();
        handleArrowNavigation(
          key === 'ArrowUp' ? 'up' : key === 'ArrowDown' ? 'down' : key === 'Home' ? 'home' : 'end',
          id,
          selectedItems,
          selectedListRef,
          setSelectedSelection,
          selectedAnchorRef,
          event,
        );
      }
    },
    [disabled, handleArrowNavigation, selectedItems],
  );

  const moveToSelected = React.useCallback(() => {
    if (disabled || availableSelection.length === 0) return;
    const incoming = availableSelection.filter((id) => availableIdSet.has(id));
    if (incoming.length === 0) return;
    const incomingSet = new Set(incoming);
    const merged = [
      ...value,
      ...options
        .filter((option) => incomingSet.has(option.id))
        .map((option) => option.id)
        .filter((id) => !valueSet.has(id)),
    ];
    onChange(merged);
    setAvailableSelection([]);
  }, [availableSelection, availableIdSet, disabled, onChange, options, value, valueSet]);

  const moveAllToSelected = React.useCallback(() => {
    if (disabled || availableItems.length === 0) return;
    const ordered = options.map((option) => option.id);
    onChange(ordered);
    setAvailableSelection([]);
    setSelectedSelection([]);
  }, [availableItems.length, disabled, onChange, options]);

  const moveToAvailable = React.useCallback(() => {
    if (disabled || selectedSelection.length === 0) return;
    const removal = new Set(selectedSelection);
    const filtered = value.filter((id) => !removal.has(id));
    onChange(filtered);
    setSelectedSelection([]);
  }, [disabled, onChange, selectedSelection, value]);

  const moveAllToAvailable = React.useCallback(() => {
    if (disabled || value.length === 0) return;
    onChange([]);
    setAvailableSelection([]);
    setSelectedSelection([]);
  }, [disabled, onChange, value.length]);

  const renderList = (
    title: React.ReactNode,
    items: TransferListOption[],
    checkedIds: Set<Identifier>,
    onItemClick: (event: React.MouseEvent<HTMLDivElement>, id: Identifier) => void,
    onItemKeyDown: (event: React.KeyboardEvent<HTMLDivElement>, id: Identifier) => void,
    listRef: React.RefObject<HTMLUListElement | null>,
    listId: string,
  ) => {
    const groupedItems = groupOptions(items, collator);
    const indexMap = new Map<Identifier, number>();
    items.forEach((item, index) => indexMap.set(item.id, index));

    return (
      <Paper
        sx={{ width: '100%', minWidth: listWidth, height: listHeight, overflow: 'auto' }}
        variant='outlined'
        // Attach scroll handler
        onScroll={onListScroll}
      >
        <Typography
          id={listId}
          variant='subtitle2'
          component='div'
          sx={{ px: 1.5, py: 1, fontWeight: 600, borderBottom: (theme) => `1px solid ${theme.palette.divider}` }}
        >
          {title}
        </Typography>
        <List
          dense
          disablePadding
          aria-labelledby={listId}
          role='listbox'
          aria-multiselectable='true'
          ref={listRef}
          sx={{
            'pt': 0,
            '& .MuiListItemButton-root': { minHeight: 0 },
          }}
        >
          {items.length === 0 ? (
            <Typography variant='body2' sx={{ px: 1.5, py: 1.5 }} color='text.secondary'>
              No items
            </Typography>
          ) : (
            groupedItems.map(([groupKey, groupItems]) => (
              <React.Fragment key={groupKey}>
                {groupKey !== NO_GROUP_KEY && (
                  <ListSubheader
                    disableSticky
                    component='div'
                    sx={{
                      bgcolor: 'background.paper',
                      fontWeight: 700,
                      fontSize: 13,
                      lineHeight: 1.25,
                      px: 2,
                      py: 1,
                      // Bold and underline categories
                      textDecoration: 'underline',
                    }}
                  >
                    {groupKey}
                  </ListSubheader>
                )}
                {groupItems.map((item) => {
                  const isSelected = checkedIds.has(item.id);
                  const itemIndex = indexMap.get(item.id) ?? 0;

                  const primaryNode =
                    typeof renderOption === 'function' ? renderOption(item) : (item.label as React.ReactNode);

                  return (
                    <ListItemButton
                      key={item.id}
                      dense
                      onClick={(event) => onItemClick(event, item.id)}
                      onKeyDown={(event) => onItemKeyDown(event, item.id)}
                      disabled={disabled}
                      selected={isSelected}
                      role='option'
                      aria-selected={isSelected}
                      data-index={itemIndex}
                      sx={{
                        'py': 0.25,
                        'pl': 3,
                        'pr': 1.5,
                        'borderLeft': '2px solid transparent',
                        '&.Mui-selected': {
                          bgcolor: (theme) => theme.palette.action.selected,
                          borderLeft: (theme) => `2px solid ${theme.palette.primary.main}`,
                        },
                        '&.Mui-focusVisible': { bgcolor: (theme) => theme.palette.action.focus },
                        'alignItems': 'flex-start',
                      }}
                    >
                      <ListItemText
                        id={`${listId}-${item.id}`}
                        primary={primaryNode}
                        primaryTypographyProps={{
                          fontSize: 12,
                          fontWeight: 400,
                          lineHeight: 1.1,
                          sx: {
                            whiteSpace: 'normal',
                            wordBreak: 'break-word',
                          },
                        }}
                      />
                    </ListItemButton>
                  );
                })}
              </React.Fragment>
            ))
          )}
        </List>
      </Paper>
    );
  };

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'stretch',
        gap: 2,
        ...sx,
      }}
    >
      <Box sx={{ flex: 1, minWidth: 0 }}>
        {renderList(
          availableLabel,
          availableItems,
          availableCheckedSet,
          handleAvailableClick,
          handleAvailableKeyDown,
          availableListRef,
          `${baseListId}-available`,
        )}
      </Box>
      <Stack spacing={1} alignItems='center' justifyContent='center' sx={{ flexShrink: 0 }}>
        <Button
          variant='outlined'
          size='small'
          onClick={moveToSelected}
          disabled={disabled || availableSelection.length === 0}
          aria-label='Move selected to chosen'
        >
          <KeyboardArrowRightIcon fontSize='small' />
        </Button>
        <Button
          variant='outlined'
          size='small'
          onClick={moveAllToSelected}
          disabled={disabled || availableItems.length === 0}
          aria-label='Move all to chosen'
        >
          <KeyboardDoubleArrowRightIcon fontSize='small' />
        </Button>
        <Button
          variant='outlined'
          size='small'
          onClick={moveToAvailable}
          disabled={disabled || selectedSelection.length === 0}
          aria-label='Move selected back to available'
        >
          <KeyboardArrowLeftIcon fontSize='small' />
        </Button>
        <Button
          variant='outlined'
          size='small'
          onClick={moveAllToAvailable}
          disabled={disabled || value.length === 0}
          aria-label='Move all back to available'
        >
          <KeyboardDoubleArrowLeftIcon fontSize='small' />
        </Button>
      </Stack>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        {renderList(
          selectedLabel,
          selectedItems,
          selectedCheckedSet,
          handleSelectedClick,
          handleSelectedKeyDown,
          selectedListRef,
          `${baseListId}-selected`,
        )}
      </Box>
    </Box>
  );
};

export default GenericTransferList;
