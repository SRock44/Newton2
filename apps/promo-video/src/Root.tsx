import { Composition } from "remotion";
import { NewtonPromo } from "./NewtonPromo";
import { FPS } from "./anim";
import { T } from "./timeline";

export const RemotionRoot = () => (
  <Composition
    id="NewtonPromo"
    component={NewtonPromo}
    durationInFrames={Math.round(FPS * T.total)}
    fps={FPS}
    width={1920}
    height={1080}
  />
);
