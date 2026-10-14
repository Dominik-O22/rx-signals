import { getAuswertungSignalsFactory } from './auswertung-signals.factory';

export const AUSWERTUNG_DEBOUNCE_MS = 25;

/** The one Auswertung instance of the app; its setup runs in the root store (see AppModule). */
export const auswertungSignals = getAuswertungSignalsFactory().build({
  defaultFilter: { jahr: 2023, kostenstelle: 'KST-100', sortierung: 'konto' },
  debounceMs: AUSWERTUNG_DEBOUNCE_MS,
  nameExtension: 'auswertung',
});
