// src/lib/permissionsNormalizer.ts
/* eslint-disable no-useless-escape */
export type ListedPermission = {
  resource: string;
  verb: string; // read | create | update | delete | all | full | custom slug (api, vpn, etc.)
  predicate: string; // raw predicate string (may be '')
};

export type Collapsed<T extends { id?: unknown } & ListedPermission> = {
  /** normalized key → original items that collapsed under it */
  keyToItems: Map<string, T[]>;
  /** one option per normalized key for the UI */
  options: Array<{ id: string; label: string; group?: string }>;
};

export type Entity = 'application' | 'device' | 'service' | 'image' | 'release' | 'user';

// Note: This type appears to be a mix of normalized predicates and special verbs.
// The normalization logic below aims to produce these predicate strings.
export type EntityGuard =
  | 'self'
  | 'app' // Note: code normalizes to 'application'
  | 'device'
  | 'image'
  | 'release'
  | 'service'
  | 'vpn'
  | 'tunnel-22222' // This is a verb, not a predicate
  | 'tunnel-48484' // This is a verb, not a predicate
  | 'device/ownedByActor'
  | 'application/ownedByActor'
  | 'service/ownedByActor'
  | 'image/ownedByActor'
  | 'public && actor can access device type'
  | 'device type of accessible device'
  | 'device || app' // Note: code normalizes to 'device || application'
  | '!Frozen';

export const aliasToEntity: Record<string, Entity> = {
  a: 'application',
  d: 'device',
  s: 'service',
  i: 'image',
  u: 'user',
  r: 'release',
};

const trimParens = (s: string) => {
  let out = s.trim();
  // remove redundant outer parentheses
  while (out.startsWith('(') && out.endsWith(')')) {
    // ensure parentheses actually wrap the whole string
    let depth = 0;
    let wraps = true;
    for (let i = 0; i < out.length; i++) {
      if (out[i] === '(') depth++;
      else if (out[i] === ')') {
        depth--;
        if (depth === 0 && i !== out.length - 1) {
          wraps = false;
          break;
        }
      }
    }
    if (wraps) out = out.slice(1, -1).trim();
    else break;
  }
  return out;
};

const collapseWhitespace = (s: string) => s.replace(/\s+/g, ' ').trim();

/**
 * Normalize operators and common boolean idioms:
 * - eq → ==
 * - and/or → &&/||
 * - eq true/false → bare / marked for negation pass
 * - not X → !X
 */
const normalizeOperators = (pred: string): string => {
  let s = ` ${pred} `;

  // Unify 'eq' to '=='
  s = s.replace(/\beq\b/gi, '==');

  // unify == true/false (we will handle is_frozen specifically later)
  s = s.replace(/\s*==\s*true/gi, '');
  s = s.replace(/\s*==\s*false/gi, ' = false'); // temporary marker

  // not ... → !...
  s = s.replace(/\bnot\s+/gi, '!');

  // and/or → &&/||
  s = s.replace(/\band\b/gi, '&&');
  s = s.replace(/\bor\b/gi, '||');

  // general "= false" marker → "!<token>"
  s = s.replace(/([A-Za-z0-9_:\/']+)\s*=\s*false/gi, '!$1');

  // standardize spacing and slashes
  s = s.replace(/\s*&&\s*/g, ' && ');
  s = s.replace(/\s*\|\|\s*/g, ' || ');
  s = s.replace(/\s*\/\s*/g, '/');

  return collapseWhitespace(s);
};

/**
 * Replace @__ACTOR_ID references with per-entity "ownedByActor" guards,
 * and collapse alias prefixes like d:d/, a:a/, etc.
 */
const normalizeActorOwnership = (pred: string): string => {
  let s = pred;

  // "id == @__ACTOR_ID" / "actor == @__ACTOR_ID"
  s = s.replace(/\bid\s*==?\s*@__ACTOR_ID\b/gi, 'self');
  s = s.replace(/\bactor\s*==?\s*@__ACTOR_ID\b/gi, 'self');
  s = s.replace(/\bis_of__actor\s*==?\s*@__ACTOR_ID\b/gi, 'self');

  // entity alias forms: a:a/, d:d/, etc → <entity>/ownedByActor
  s = s.replace(
    /\b([adsiru]):\1\/actor\s*==?\s*@__ACTOR_ID\b/gi,
    (_m, alias) => `${aliasToEntity[String(alias).toLowerCase()]}/ownedByActor`,
  );

  // also common any() forms → <entity>/ownedByActor
  // These are optimizations for when 'any()' contains *only* the actor check.
  s = s.replace(/\bdevice\/any\(\s*d:d\/actor\s*==?\s*@__ACTOR_ID\s*\)/gi, 'device/ownedByActor');
  s = s.replace(/\bapplication\/any\(\s*a:a\/actor\s*==?\s*@__ACTOR_ID\s*\)/gi, 'application/ownedByActor');
  s = s.replace(/\bservice\/any\(\s*s:s\/actor\s*==?\s*@__ACTOR_ID\s*\)/gi, 'service/ownedByActor');
  s = s.replace(/\bimage\/any\(\s*i:i\/actor\s*==?\s*@__ACTOR_ID\s*\)/gi, 'image/ownedByActor');
  s = s.replace(/\buser\/any\(\s*u:u\/actor\s*==?\s*@__ACTOR_ID\s*\)/gi, 'user/ownedByActor');

  // belongs_to__application/any(a:a/actor == @__ACTOR_ID)
  s = s.replace(
    /\bbelongs_to__application\/any\(\s*a:a\/actor\s*==?\s*@__ACTOR_ID\s*\)/gi,
    'belongs_to__application/any(application/ownedByActor)',
  );

  return s;
};

/**
 * Canonicalize "Frozen" checks across variants:
 * - NEGATIVE:  "!is_frozen", "is_frozen == false", "!d/is_frozen" → "!Frozen"
 * - POSITIVE:  "is_frozen", "is_frozen == true", "d/is_frozen"     → "Frozen"
 *
 * We do NOT collapse Frozen and !Frozen into one — they remain distinct.
 */
const normalizeFrozen = (pred: string): string => {
  let s = pred;

  // Un-alias any d:d/is_frozen, a:a/is_frozen, etc. → is_frozen
  s = s.replace(/\b([adsiru]):\1\/is_frozen\b/gi, 'is_frozen');
  s = s.replace(/\bd\/is_frozen\b/gi, 'is_frozen');

  // NEGATIVE forms first:
  //  "!is_frozen" (from "not is_frozen")
  //  "is_frozen == false" already became "!is_frozen" in operator pass
  // So catch all forms.
  s = s.replace(/\b!is_frozen\b/gi, '!Frozen');

  // POSITIVE forms:
  //  "is_frozen" (bare), "is_frozen == true" (removed "== true" earlier)
  // Map only remaining bare "is_frozen" tokens to "Frozen"
  s = s.replace(/\bis_frozen\b/gi, 'Frozen');

  return s;
};

/**
 * Pretty-print common canAccess()/any() constructs to human readable guards
 * without losing the logic.
 */
const prettySVBR = (pred: string): string => {
  if (!pred) return '';
  let s = pred;

  // is_for__device_type/canAccess() → actor can access device type
  s = s.replace(/\bis_for__device_type\/canAccess\(\)/gi, 'actor can access device type');

  // is_for__device_type/any(dt:dt/describes__device/canAccess()) → device type of accessible device
  s = s.replace(
    /\bis_for__device_type\/any\(\s*dt:dt\/describes__device\/canAccess\(\)\s*\)/gi,
    'device type of accessible device',
  );

  // describes__device/canAccess() → device type of accessible device
  s = s.replace(/\bdescribes__device\/canAccess\(\)/gi, 'device type of accessible device');

  // Drop alias prefixes inside any():
  s = s.replace(/\bapplication\/any\(\s*a:a\//gi, 'application/any(');
  s = s.replace(/\brelease\/any\(\s*r:r\//gi, 'release/any(');
  s = s.replace(/\bimage\/any\(\s*i:i\//gi, 'image/any(');
  s = s.replace(/\bservice\/any\(\s*s:s\//gi, 'service/any(');
  s = s.replace(/\bdevice\/any\(\s*d:d\//gi, 'device/any(');
  s = s.replace(/\buser\/any\(\s*u:u\//gi, 'user/any(');

  // Simplify common canAccess targets
  const canMap: Array<[RegExp, string]> = [
    [/\bdevice\/canAccess\(\)/gi, 'device'],
    [/\bapplication\/canAccess\(\)/gi, 'application'],
    [/\bservice\/canAccess\(\)/gi, 'service'],
    [/\bservice_install\/canAccess\(\)/gi, 'serviceInstall'],
    [/\brelease_image\/canAccess\(\)/gi, 'release'],
    [/\bimage__is_part_of__release\/canAccess\(\)/gi, 'release'],
    [/\brelease\/canAccess\(\)/gi, 'release'],
    [/\bimage_install\/canAccess\(\)/gi, 'image'],
    [/\bbelongs_to__application\/canAccess\(\)/gi, 'application'],
    [/\bshould_be_running_on__device\/canAccess\(\)/gi, 'device'],
    [/\bis_pinned_to__device\/canAccess\(\)/gi, 'device'],
    [/\bowns__device\/canAccess\(\)/gi, 'device'], // Added this missing rule
  ];
  for (const [re, rep] of canMap) s = s.replace(re, rep);

  // actor equality if any instance slipped through
  s = s.replace(/\bactor\s*==?\s*@__ACTOR_ID\b/gi, 'self');
  s = s.replace(/\bis_of__actor\s*==?\s*@__ACTOR_ID\b/gi, 'self');

  // 'is_public' or 'is_public == true' → 'public'
  // (normalizeOperators already handles '== true')
  s = s.replace(/\bis_public\b/gi, 'public');

  // Normalize 'vpn' guard
  s = s.replace(/\bservice_type\s*==?\s*'vpn'\b/gi, 'vpn');

  // Cleanup nested any() with prettified fragments
  s = s.replace(
    /\bapplication\/any\(\s*public\s*&&\s*actor can access device type\s*\)/gi,
    'application(public && actor can access device type)',
  );
  s = s.replace(
    /\bbelongs_to__application\/any\(\s*public\s*&&\s*actor can access device type\s*\)/gi,
    'belongs_to__application(any public + actor can access device type)',
  );

  // Final tidy: remove alias prefixes like "dt:dt/" that may remain
  s = s.replace(/\b([adsiru]):\1\//gi, '');

  s = trimParens(collapseWhitespace(s));
  return s;
};

/**
 * Normalize a predicate end-to-end.
 */
export const normalizePredicate = (rawPredicate: string): string => {
  if (!rawPredicate) return '';

  let s = rawPredicate;

  // 1) Unify operators / true/false idioms
  s = normalizeOperators(s);

  // 2) Ownership and @__ACTOR_ID
  s = normalizeActorOwnership(s);

  // 3) Normalize Frozen variants (positive → "Frozen", negative → "!Frozen")
  s = normalizeFrozen(s);

  // 4) Pretty-print SVBR shapes
  s = prettySVBR(s);

  // 5) Micro-cleanups
  s = s.replace(/\(\s+/g, '(').replace(/\s+\)/g, ')');
  // Generically collapse '.../any(' to '...('
  s = s.replace(/\b([\w_]+)\/any\(/g, '$1(');
  // Handle double-negations from 'not (x == false)'
  s = s.replace(/!!/g, ''); // !!X → X
  s = trimParens(collapseWhitespace(s));

  return s;
};

/**
 * Build a normalized key for grouping / collapsing.
 * Keys must be stable across equivalent legacy variants.
 */
export const buildNormalizedKey = (resource: string, verb: string, predicate: string): string => {
  const v = verb === 'full' ? 'all' : verb.toLowerCase();
  const p = normalizePredicate(predicate);
  return `${resource}.${v}${p ? `?${p}` : ''}`;
};

/**
 * Human label for one action (used in list items)
 * e.g. 'read (device/ownedByActor && !Frozen)'
 */
export const renderActionLabel = (verb: string, predicate: string): string => {
  const v = verb === 'full' ? 'all' : verb;
  const p = normalizePredicate(predicate);
  const label = p ? `${v} (${p})` : v;
  return label.replace(/\s*\(\s*\)\s*$/, ''); // drop empty ()
};

/**
 * Collapse: given a list of permissions (already parsed to resource/verb/predicate),
 * return a structure with a single option per normalized key and maps for expansion.
 */
export function collapsePermissions<T extends { id?: unknown } & ListedPermission>(
  items: (T & { resource: string })[],
): Collapsed<T> {
  const keyToItems = new Map<string, T[]>();

  for (const it of items) {
    const key = buildNormalizedKey(it.resource, it.verb, it.predicate);
    const bucket = keyToItems.get(key);
    if (bucket) bucket.push(it);
    else keyToItems.set(key, [it]);
  }

  // Build UI options
  const options: Array<{ id: string; label: string; group?: string }> = [];
  for (const [key, list] of keyToItems.entries()) {
    const rep = list[0]!;
    options.push({
      id: key,
      label: renderActionLabel(rep.verb, rep.predicate),
      group: rep.resource,
    });
  }

  // Sort options by group then label
  options.sort((a, b) => {
    const ga = a.group ?? '';
    const gb = b.group ?? '';
    return ga === gb ? a.label.localeCompare(b.label) : ga.localeCompare(gb);
  });

  return { keyToItems, options };
}

/**
 * Expand: take normalized keys selected in the UI and return the original items
 * (every historical variant) in a stable order.
 */
export function expandSelections<T extends { id?: unknown; resource: string; verb: string; predicate: string }>(
  collapsed: Collapsed<T>,
  selectedKeys: string[],
): T[] {
  const out: T[] = [];
  for (const k of selectedKeys) {
    const bucket = collapsed.keyToItems.get(k);
    if (bucket) out.push(...bucket);
  }
  // stable-ish order by resource, verb, raw predicate
  out.sort((a, b) => {
    if (a.resource !== b.resource) return a.resource.localeCompare(b.resource);
    if (a.verb !== b.verb) return a.verb.localeCompare(b.verb);
    return (a.predicate || '').localeCompare(b.predicate || '');
  });
  return out;
}

/**
 * Parse a raw permission string.
 * This has been rewritten for correctness.
 */
export const parseRawPermission = (raw: string): ListedPermission & { resource: string } => {
  // Examples:
  //  resin.device.read?actor eq @__ACTOR_ID
  //  resin.application_config_variable.all
  //  service.api
  //  service
  //  auth.create_token

  const [main, predRaw = ''] = raw.split('?');
  const parts = main.split('.');

  let resource: string;
  let verb: string;

  if (parts.length === 1) {
    // e.g. "service"
    resource = parts[0];
    verb = 'full';
  } else {
    // e.g. "resin.device.read" or "auth.create_token"
    // .pop() is guaranteed to return a string since length > 1
    verb = parts.pop()!;
    let resourcePath = parts.join('.');
    if (resourcePath.startsWith('resin.')) {
      resourcePath = resourcePath.substring(6); // remove "resin."
    }
    // resourcePath is now "device" or "application_config_variable" or "auth"
    resource = resourcePath;
  }

  return {
    resource,
    verb: verb || 'full', // Safeguard, though verb should be set
    predicate: predRaw || '',
  };
};
