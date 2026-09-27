import { Composition } from "remotion";
import { FPS, SHOW_FPS } from "./anim";
import { ResearchFilm } from "./paper/ResearchFilm";
import { T as RT } from "./paper/timeline";
import { ShowFilm } from "./show/ShowFilm";
import { T } from "./show/timeline";
import { StudyFilm } from "./study/StudyFilm";
import { T as ST } from "./study/timeline";

export const RemotionRoot = () => (
  <>
    <Composition
      id="ShowFilm"
      component={ShowFilm}
      durationInFrames={Math.ceil(SHOW_FPS * T.total)}
      fps={SHOW_FPS}
      width={1920}
      height={1080}
    />
    <Composition
      id="StudyFilm"
      component={StudyFilm}
      durationInFrames={Math.ceil(FPS * ST.total)}
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
