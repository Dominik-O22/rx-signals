export type Locale = 'de' | 'en';

export type User = {
  id: string;
  name: string;
  roles: ReadonlyArray<'controller' | 'admin' | 'viewer'>;
};

export type AppConfig = {
  pageSize: number;
  currency: 'EUR';
  environment: 'fixture';
};

export type AppNotification = {
  kind: 'info' | 'success' | 'error';
  text: string;
};

export type AppHeader = {
  userName: string | null;
  locale: Locale;
  notificationCount: number;
};

export type AuswertungFilter = {
  jahr: number;
  kostenstelle: string;
  sortierung: 'betrag' | 'konto';
};

export type AuswertungZeile = {
  konto: string;
  bezeichnung: string;
  betrag: number;
};

export type AuswertungErgebnis = {
  zeilen: ReadonlyArray<AuswertungZeile>;
  summe: number;
};

export type KostenstelleForm = {
  nummer: string;
  bezeichnung: string;
  verantwortlich: string;
  budget: number;
};

/** `null` means valid, matching the default `isValidationResultValid` of the rc23 factory. */
export type KostenstelleValidation = Partial<Record<keyof KostenstelleForm, string>> | null;

export type KostenstelleSaveResult = {
  id: string;
  nummer: string;
  version: number;
};

export type BerichtFilter = {
  zeitraum: 'monat' | 'quartal' | 'jahr';
  nurEigene: boolean;
};

export type BerichtEintrag = {
  id: string;
  titel: string;
  zeitraum: BerichtFilter['zeitraum'];
};
