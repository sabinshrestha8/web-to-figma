export const metadata = { title: "Selects" };

/**
 * An outlined select with a shrunk floating label: the fieldset reserves a notch
 * in the top border (the legend below), which Figma cannot gap → NOTCHED_OUTLINE.
 */
export default function Selects() {
  return (
    <div className="min-h-screen bg-white p-10 text-slate-900">
      <style>{`
        .mui-field { position: relative; width: 320px; font-size: 16px; }
        .mui-label {
          position: absolute; left: 0; top: 0; z-index: 1; pointer-events: none;
          transform-origin: top left; color: rgba(15, 23, 42, 0.6);
          transform: translate(14px, -9px) scale(0.75); max-width: calc(133% - 32px);
        }
        .mui-box {
          box-sizing: border-box; height: 56px; border-radius: 4px;
          padding: 16.5px 14px; display: flex; align-items: center;
        }
        .mui-field fieldset {
          position: absolute; inset: 0; margin: 0; padding: 0 8px; border-radius: 4px;
          border: 1px solid rgba(15, 23, 42, 0.23); pointer-events: none;
        }
        .mui-field legend { visibility: hidden; height: 11px; font-size: 0.75em; padding: 0; }
        .mui-field legend span { padding-left: 5px; padding-right: 5px; display: inline-block; opacity: 0; }
        .mui-field legend.wide { width: 100px; }
        .pseudo-top { position: relative; }
        .pseudo-top::before {
          content: ""; display: block; position: absolute;
          top: -1px; left: 8px; right: 8px; height: 2px;
          background: rgb(37, 99, 235);
        }
      `}</style>

      <div data-testid="select-filled" className="mui-field">
        <label data-testid="select-label" htmlFor="select-value" className="mui-label">
          Choose Type
        </label>
        <div className="mui-box">
          <span id="select-value">Employee By Department</span>
        </div>
        <svg
          data-testid="select-chevron"
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
          style={{ position: "absolute", right: 7, top: "calc(50% - 12px)", pointerEvents: "none" }}
        >
          <path d="M7 10l5 5 5-5" stroke="#475569" strokeWidth="2" fill="none" />
        </svg>
        <fieldset aria-hidden="true">
          <legend className="wide">
            <span>Choose Type</span>
          </legend>
        </fieldset>
      </div>

      <div className="mui-field">
        <div
          data-testid="select-outline"
          className="mui-box"
          style={{ border: "none", outline: "2px solid rgb(37, 99, 235)", outlineOffset: 0 }}
        >
          <span>Outlined control</span>
        </div>
      </div>

      <div className="mui-field">
        <div data-testid="select-pseudo" className="mui-box pseudo-top">
          <span>With pseudo hairline</span>
        </div>
      </div>
    </div>
  );
}
