import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NumberDot, ThemeContext } from "./components";
import { themeFor } from "./palette";

const dot = (props: Record<string, unknown>) =>
  renderToStaticMarkup(React.createElement(ThemeContext.Provider, { value: themeFor(props) }, React.createElement(NumberDot, { n: 2, size: 38 })));

describe("a step number's disc", () => {
  const theme = { bg: "#221710", accent: "#eb9046" };
  it("as designed: a white digit on the accent disc", () => {
    const html = dot({ theme });
    expect(html).toContain("background:#eb9046");
    expect(html).toContain("color:#fff");
  });
  it("drawn in the plain text colour (the last readability fix), its digit takes the ground colour", () => {
    const html = dot({ theme, plain: true });
    expect(html).toContain("background:#FFFFFF");
    expect(html).toContain("color:#221710");
  });
});
