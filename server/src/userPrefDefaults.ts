import type { Request } from 'express';

type PrefMap = Record<string, unknown>;

const BUILTIN_USER_DEFAULTS: PrefMap = {
  fontFamily: 'Calibri, system-ui, Arial, sans-serif',
  dragBehavior: 'swap',
  animationSpeed: 'normal',
  chipDisplayMode: 'image+text',
  checklistSpacing: 15,
  checkboxSize: 20,
  checklistTextSize: 15,
  noteWidth: 288,
  noteLineSpacing: 1.38,
  disableNoteCardLinks: false,
};

const BUILTIN_DEVICE_DEFAULTS: PrefMap = {
  themeChoice: 'system',
  cardTitleSize: 20,
  animationsEnabled: true,
  imageThumbSize: 96,
  editorImageThumbSize: 115,
  editorImagesExpandedByDefault: false,
  disableNoteCardLinks: false,
  chipDisplayMode: 'image+text',
};

// Hard-coded registration-time device defaults.
// Edit these values directly to control first-time defaults by device class.
const HARD_CODED_DEVICE_BUCKET_DEFAULTS: Record<'mobile' | 'tablet' | 'desktop', PrefMap> = {
  mobile: {
    // Note Card Preferences
    cardTitleSize: 16,
    cardNoteLineSpacing: 1.38,
    cardChecklistSpacing: 9,
    cardCheckboxSize: 19,
    cardChecklistTextSize: 16,
    // Note Editor Preferences
    editorNoteLineSpacing: 1.18,
    editorChecklistSpacing: 6,
    editorCheckboxSize: 18,
    editorChecklistTextSize: 16,
    // Shared device fallback prefs
    noteLineSpacing: 1.18,
    checklistSpacing: 9,
    checkboxSize: 19,
    checklistTextSize: 16,
    // Layout
    noteWidth: 288,
    imageThumbSize: 96,
    editorImageThumbSize: 115,
    // Other device-scoped prefs
    editorImagesExpandedByDefault: false,
    disableNoteCardLinks: false,
    chipDisplayMode: 'image+text',
    fontFamily: 'Calibri, system-ui, Arial, sans-serif',
  },
  tablet: {
    // Note Card Preferences
    cardTitleSize: 20,
    cardNoteLineSpacing: 1.38,
    cardChecklistSpacing: 15,
    cardCheckboxSize: 20,
    cardChecklistTextSize: 17,
    // Note Editor Preferences
    editorNoteLineSpacing: 1.38,
    editorChecklistSpacing: 8,
    editorCheckboxSize: 18,
    editorChecklistTextSize: 14,
    // Shared device fallback prefs
    noteLineSpacing: 1.38,
    checklistSpacing: 15,
    checkboxSize: 20,
    checklistTextSize: 17,
    // Layout
    noteWidth: 288,
    imageThumbSize: 96,
    editorImageThumbSize: 115,
    // Other device-scoped prefs
    editorImagesExpandedByDefault: false,
    disableNoteCardLinks: false,
    chipDisplayMode: 'image+text',
    fontFamily: 'Calibri, system-ui, Arial, sans-serif',
  },
  desktop: {
    // Note Card Preferences
    cardTitleSize: 20,
    cardNoteLineSpacing: 1.38,
    cardChecklistSpacing: 15,
    cardCheckboxSize: 20,
    cardChecklistTextSize: 17,
    // Note Editor Preferences
    editorNoteLineSpacing: 1.38,
    editorChecklistSpacing: 8,
    editorCheckboxSize: 18,
    editorChecklistTextSize: 14,
    // Shared device fallback prefs
    noteLineSpacing: 1.38,
    checklistSpacing: 15,
    checkboxSize: 20,
    checklistTextSize: 17,
    // Layout
    noteWidth: 288,
    imageThumbSize: 96,
    editorImageThumbSize: 115,
    // Other device-scoped prefs
    editorImagesExpandedByDefault: false,
    disableNoteCardLinks: false,
    chipDisplayMode: 'image+text',
    fontFamily: 'Calibri, system-ui, Arial, sans-serif',
  },
};

function classifyDeviceBucket(req: Request, deviceName?: string): 'mobile' | 'tablet' | 'desktop' {
  const dn = String(deviceName || '').toLowerCase();
  const ua = String(req.headers['user-agent'] || '').toLowerCase();
  const hay = `${dn} ${ua}`;

  if (/(ipad|tablet|tab\b|sm-t\d|galaxy tab|fire hd|kindle)/i.test(hay)) return 'tablet';
  if (/(iphone|android|pixel|mobi|phone)/i.test(hay)) return 'mobile';
  return 'desktop';
}

export function getInitialUserPrefs(): PrefMap {
  return { ...BUILTIN_USER_DEFAULTS };
}

export function getInitialDevicePrefs(req: Request, deviceName: string, user: PrefMap): PrefMap {
  const bucket = classifyDeviceBucket(req, deviceName);

  const legacyChecklistSpacing = user.checklistSpacing;
  const legacyCheckboxSize = user.checkboxSize;
  const legacyChecklistTextSize = user.checklistTextSize;
  const legacyNoteLineSpacing = user.noteLineSpacing;

  const seededFromUser: PrefMap = {
    checklistSpacing: legacyChecklistSpacing,
    checkboxSize: legacyCheckboxSize,
    checklistTextSize: legacyChecklistTextSize,
    noteLineSpacing: legacyNoteLineSpacing,
    cardChecklistSpacing: legacyChecklistSpacing,
    cardCheckboxSize: legacyCheckboxSize,
    cardChecklistTextSize: legacyChecklistTextSize,
    cardNoteLineSpacing: legacyNoteLineSpacing,
    editorChecklistSpacing: legacyChecklistSpacing,
    editorCheckboxSize: legacyCheckboxSize,
    editorChecklistTextSize: legacyChecklistTextSize,
    editorNoteLineSpacing: legacyNoteLineSpacing,
    noteWidth: user.noteWidth,
    fontFamily: user.fontFamily,
    dragBehavior: user.dragBehavior,
    animationSpeed: user.animationSpeed,
    chipDisplayMode: user.chipDisplayMode,
    disableNoteCardLinks: user.disableNoteCardLinks,
  };

  return {
    ...BUILTIN_DEVICE_DEFAULTS,
    ...seededFromUser,
    ...(HARD_CODED_DEVICE_BUCKET_DEFAULTS[bucket] || {}),
  };
}
