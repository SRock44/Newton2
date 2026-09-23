import { Composition } from "remotion";
import { FPS } from "./anim";
import { ResearchFilm } from "./paper/ResearchFilm";
import { T as RT } from "./paper/timeline";
import { ShowFilm } from "./show/ShowFilm";
import { T } from "./show/timeline";

export const RemotionRoot = () => (
  <>
    <Composition
      id="ShowFilm"
      component={ShowFilm}
      durationInFrames={Math.ceil(FPS * T.total)}
      fps={FPS}
      width={1920}
      height={1080}
    />
    <Composition
      id="ResearchFilm"
      component={ResearchFilm}
      durationInFrames={Math.ceil(FPS * RT.total)}
      fps={FPS}
      width={1920}
      height={1080}
    />
  </>
);
