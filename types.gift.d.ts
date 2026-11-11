// public/js/gift/ is a ported module that is not written to this project's strict JSDoc types, so
// tsc does not read it (tsconfig.json leaves `#gift/` out of `paths`). This is the part of it the
// app calls, kept in step with public/js/gift/birthday.js by hand.
declare module '#gift/birthday.js' {
  export type WrapMode = 'auto' | 'always' | 'never';

  /** Christoph's birthday, every year: "11-11". */
  export const BIRTHDAY: string;

  /** Wrap the page in gift paper on the birthday; the mode comes from `?wrap=` unless given. */
  export function wrapBirthday(config?: {
    mode?: WrapMode;
    when?: string;
    search?: string;
    options?: Record<string, unknown>;
    now?: () => Date;
  }): { current: object | null; stop: () => void };

  /** The mode from a query string: `?wrap=always|never|auto`; anything else is auto. */
  export function readMode(search: string): WrapMode;
}
