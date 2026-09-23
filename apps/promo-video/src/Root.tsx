import { Composition } from "remotion";
import { NewtonPromo } from "./NewtonPromo";
import { EngineerFilm } from "./eng/EngineerFilm";
import { FPS } from "./anim";
import { T } from "./timeline";
import { T as ET } from "./eng/timeline";

export const RemotionRoot = () => (
  <>
    <Composition
      id="NewtonPromo"
      component={NewtonPromo}
      durationInFrames={Math.round(FPS * T.total)}
      fps={FPS}
      width={1920}
      height={1080}
    />
    <Composition
      id="EngineerFilm"
      component={EngineerFilm}
      durationInFrames={Math.ceil(FPS * ET.total)}
      fps={FPS}
      width={1920}
      height={1080}
    />
  </>
);
