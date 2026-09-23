import { Composition } from "remotion";
import { FPS } from "./anim";
import { ShowFilm } from "./show/ShowFilm";
import { T } from "./show/timeline";

export const RemotionRoot = () => (
  <Composition
    id="ShowFilm"
    component={ShowFilm}
    durationInFrames={Math.ceil(FPS * T.total)}
    fps={FPS}
    width={1920}
    height={1080}
  />
);
