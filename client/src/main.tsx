import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

function applySavedPrefs() {
	try {
		const root = document.documentElement;
			const map: { [k: string]: string } = {
				'prefs.checklistSpacing': '--checklist-gap',
				'prefs.checkboxSize': '--checklist-checkbox-size',
				'prefs.checklistTextSize': '--checklist-text-size',
				'prefs.checkboxBg': '--checkbox-bg',
				'prefs.checkboxBorder': '--checkbox-border',
				'prefs.noteWidth': '--note-card-width',
				'prefs.fontFamily': '--app-font-family',
			};
			const pxKeys = new Set(['prefs.checklistSpacing', 'prefs.checkboxSize', 'prefs.checklistTextSize', 'prefs.noteWidth']);
			Object.entries(map).forEach(([key, cssVar]) => {
				const v = localStorage.getItem(key);
				if (v === null || v === '') return;
				// append 'px' for numeric preferences stored without unit
				if (pxKeys.has(key)) {
					// if value already contains non-digit (like ends with 'px' or contains '%'), use as-is
					if (/[^0-9.-]/.test(v)) root.style.setProperty(cssVar, v);
					else root.style.setProperty(cssVar, `${v}px`);
				} else {
					root.style.setProperty(cssVar, v);
				}
			});
			// request grid recalculation early so first notes respect width
			try { window.dispatchEvent(new Event('notes-grid:recalc')); } catch {}
	} catch (err) { console.warn('Failed to apply saved prefs', err); }
}

applySavedPrefs();

const root = createRoot(document.getElementById("root")!);
root.render(<App />);
