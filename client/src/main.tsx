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
				'prefs.noteWidth': '--note-card-width',
				'prefs.imageThumbSize': '--image-thumb-size',
				'prefs.editorImageThumbSize': '--editor-image-thumb-size',
				'prefs.fontFamily': '--app-font-family',
				'prefs.noteLineSpacing': '--note-line-height',
				// Split appearance prefs (card vs editor)
				'prefs.cardTitleSize': '--card-title-size',
				'prefs.cardChecklistSpacing': '--card-checklist-gap',
				'prefs.cardCheckboxSize': '--card-checklist-checkbox-size',
				'prefs.cardChecklistTextSize': '--card-checklist-text-size',
				'prefs.cardNoteLineSpacing': '--card-note-line-height',
				'prefs.editorChecklistSpacing': '--editor-checklist-gap',
				'prefs.editorCheckboxSize': '--editor-checklist-checkbox-size',
				'prefs.editorChecklistTextSize': '--editor-checklist-text-size',
				'prefs.editorNoteLineSpacing': '--editor-note-line-height',
				'prefs.linkColorDark': '--link-color-dark',
				'prefs.linkColorLight': '--link-color-light',
			};
			const pxKeys = new Set([
				'prefs.checklistSpacing',
				'prefs.checkboxSize',
				'prefs.checklistTextSize',
				'prefs.noteWidth',
				'prefs.imageThumbSize',
				'prefs.editorImageThumbSize',
				'prefs.cardTitleSize',
				'prefs.cardChecklistSpacing',
				'prefs.cardCheckboxSize',
				'prefs.cardChecklistTextSize',
				'prefs.editorChecklistSpacing',
				'prefs.editorCheckboxSize',
				'prefs.editorChecklistTextSize',
			]);
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

function applyStandaloneFlag() {
	try {
		const nav: any = navigator as any;
		const standalone = (!!window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || nav?.standalone === true;
		document.documentElement.setAttribute('data-standalone', standalone ? 'true' : 'false');
	} catch {}
}

applyStandaloneFlag();
window.addEventListener('pageshow', applyStandaloneFlag);
document.addEventListener('visibilitychange', () => {
	if (!document.hidden) applyStandaloneFlag();
});

function applyBrowserEngineFlag() {
	try {
		const ua = String(navigator.userAgent || '').toLowerCase();
		const isFirefox = ua.includes('firefox') || ua.includes('fxios');
		const isChromium = !isFirefox && (ua.includes('chrome') || ua.includes('crios') || ua.includes('chromium') || ua.includes('edg/') || ua.includes('opr/'));
		const coarse = !!window.matchMedia?.('(pointer: coarse)')?.matches;
		const mobileUa = /android|iphone|ipad|ipod|mobile/.test(ua);
		const mobileLike = coarse || mobileUa;

		const root = document.documentElement;
		if (isChromium) root.setAttribute('data-browser-engine', 'chromium');
		else if (isFirefox) root.setAttribute('data-browser-engine', 'firefox');
		else root.setAttribute('data-browser-engine', 'other');
		root.setAttribute('data-mobile-browser', mobileLike ? 'true' : 'false');
	} catch {}
}

applyBrowserEngineFlag();
window.addEventListener('pageshow', applyBrowserEngineFlag);
window.addEventListener('resize', applyBrowserEngineFlag);

// Service worker: Safari/iOS-hardened registration path.
try {
	if ('serviceWorker' in navigator && window.isSecureContext) {
		(async () => {
			try {
				await new Promise<void>((resolve) => {
					if (document.readyState === 'complete') return resolve();
					window.addEventListener('load', () => resolve(), { once: true });
				});

				const regs = await navigator.serviceWorker.getRegistrations();
				let hasOur = false;
				for (const reg of regs) {
					const scriptUrl = String(reg.active?.scriptURL || reg.waiting?.scriptURL || reg.installing?.scriptURL || '');
					const isOur = scriptUrl.endsWith('/sw.js') || scriptUrl.includes('/sw.js?');
					if (isOur) { hasOur = true; continue; }
					try { await reg.unregister(); } catch {}
				}

				const reg = hasOur
					? (await navigator.serviceWorker.getRegistration('/')) || null
					: await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' });

				if (reg) {
					try { await reg.update(); } catch {}

					if (reg.waiting) {
						try { reg.waiting.postMessage({ type: 'SKIP_WAITING' }); } catch {}
					}

					reg.addEventListener('updatefound', () => {
						const worker = reg.installing;
						if (!worker) return;
						worker.addEventListener('statechange', () => {
							if (worker.state === 'installed' && navigator.serviceWorker.controller) {
								try { worker.postMessage({ type: 'SKIP_WAITING' }); } catch {}
							}
						});
					});

					const reloadKey = 'freemannotes.sw.reloadOnce';
					navigator.serviceWorker.addEventListener('controllerchange', () => {
						try {
							if (sessionStorage.getItem(reloadKey)) return;
							sessionStorage.setItem(reloadKey, '1');
							window.location.reload();
						} catch {}
					});
				}
			} catch {}
		})();
	}
} catch {}

const root = createRoot(document.getElementById("root")!);
root.render(<App />);
