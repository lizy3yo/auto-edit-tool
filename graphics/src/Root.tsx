import React from "react";
import { Composition } from "remotion";
import { loadInter } from "./fonts";
import { MeasuringContext, ThemeContext } from "./components";
import { ExitContext, ShadeContext } from "./overlays";
import { TEMPLATES, type TemplateDef } from "./registry";
import { themeFor } from "./palette";
import { FPS, HEIGHT, WIDTH } from "./theme";

loadInter();

/** Every template gets the shared per-cue settings through context: how it leaves, how much it
 * darkens behind its words (`shade`, set from the measured contrast), and the
 * video's colours (`theme`, made from its host photo by scripts/theme.mts; Steve's navy if none). */
const withCueSettings = (def: TemplateDef): React.FC<Record<string, unknown>> => {
  const C = def.component;
  const Wrapped: React.FC<Record<string, unknown>> = raw => {
    // The renderer sends `null` for every sample setting a cue leaves out (so Remotion's
    // default-props merge cannot show sample text). Back to "not set" here, so each template's
    // own fallback applies — `emphasis = []`, `winner = "none"`, a caption's `top`.
    const props = Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== null));
    const theme = themeFor(props);
    return (
      <ThemeContext.Provider value={theme}>
        <ExitContext.Provider value={props.exit === "cut" ? "cut" : def.dims ? "scrim" : "fade"}>
          <ShadeContext.Provider value={typeof props.shade === "number" ? props.shade : 0}>
            <MeasuringContext.Provider value={props.measuring === true}>
              {/* A measuring copy keeps only the WORDS readable-or-not: every border (a plate's
                  accent edge, an outline round a kept item, a stamp's frame) is drawn see-through
                  at its same size, so no word moves — in every template, including later ones. */}
              {props.measuring === true && <style>{"* { border-color: transparent !important; }"}</style>}
              <C {...props} />
            </MeasuringContext.Provider>
          </ShadeContext.Provider>
        </ExitContext.Provider>
      </ThemeContext.Provider>
    );
  };
  Wrapped.displayName = `Cue(${def.id})`;
  return Wrapped;
};

export const RemotionRoot: React.FC = () => (
  <>
    {TEMPLATES.map(t => (
      <Composition
        key={t.id}
        id={t.id}
        component={withCueSettings(t)}
        fps={FPS}
        width={WIDTH}
        height={HEIGHT}
        durationInFrames={Math.round(t.defaultProps.durationSec * FPS)}
        defaultProps={t.defaultProps}
        calculateMetadata={({ props }) => ({
          durationInFrames: Math.max(1, Math.round((props as { durationSec: number }).durationSec * FPS)),
        })}
      />
    ))}
  </>
);
