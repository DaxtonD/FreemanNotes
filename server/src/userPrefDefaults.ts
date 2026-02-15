import type { Request } from 'express';

type PrefMap = Record<string, unknown>;

const BUILTIN_USER_DEFAULTS: PrefMap = {
  fontFamily: 'Calibri, system-ui, Arial, sans-serif',
  dragBehavior: 'swap',
  animationSpeed: 'normal',
  checklistSpacing: 15,
  checkboxSize: 20,
  checklistTextSize: 17,
  noteWidth: 288,
  noteLineSpacing: 1.38,
};

const BUILTIN_DEVICE_DEFAULTS: PrefMap = {
  themeChoice: 'system',
  cardTitleSize: 20,
  animationsEnabled: true,
  imageThumbSize: 96,
  editorImageThumbSize: 115,
  editorImagesExpandedByDefault: false,
  disableNoteCardLinks: false,
};

// Hard-coded registration-time device defaults.
// Edit these values directly to control first-time defaults by device class.
const HARD_CODED_DEVICE_BUCKET_DEFAULTS: Record<'mobile' | 'tablet' | 'desktop', PrefMap> = {
  mobile: {
    cardChecklistSpacing: 16,
    cardCheckboxSize: 21,
    cardChecklistTextSize: 18,
    cardNoteLineSpacing: 1.42,
    editorChecklistSpacing: 16,
    editorCheckboxSize: 21,
    editorChecklistTextSize: 18,
    editorNoteLineSpacing: 1.42,
    imageThumbSize: 92,
    editorImageThumbSize: 106,
  },
  tablet: {
    cardChecklistSpacing: 15,
    cardCheckboxSize: 20,
    cardChecklistTextSize: 17,
    cardNoteLineSpacing: 1.4,
    editorChecklistSpacing: 15,
    editorCheckboxSize: 20,
    editorChecklistTextSize: 17,
    editorNoteLineSpacing: 1.4,
    imageThumbSize: 96,
    editorImageThumbSize: 112,
  },
  desktop: {
    cardChecklistSpacing: 14,
    cardCheckboxSize: 18,
    cardChecklistTextSize: 16,
    cardNoteLineSpacing: 1.36,
    editorChecklistSpacing: 14,
    editorCheckboxSize: 18,
    editorChecklistTextSize: 16,
    editorNoteLineSpacing: 1.36,
    imageThumbSize: 100,
    editorImageThumbSize: 120,
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
