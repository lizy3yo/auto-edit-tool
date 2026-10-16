// Studio / CLI defaults. The render scripts set the same values explicitly through the
// renderer API, so a render never depends on this file being picked up.
import { Config } from "@remotion/cli/config";

Config.setVideoImageFormat("png");
Config.setConcurrency(4);
Config.setChromiumOpenGlRenderer("angle");
