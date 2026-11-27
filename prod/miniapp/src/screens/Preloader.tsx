import { useEffect, useRef, useState } from "react";
import { glow, playGlow } from "../data/content";

const STATES = ["21", "22", "23", "24"];     // фреймы состояний знака в «Итоговом брендинге»
const STEP = 1100;                             // сколько держится каждое состояние знака

// Что Vilar «делает», пока грузится приложение — сменяются внизу экрана.
// На каждой загрузке берём SHOWN случайных из пула, без повторов.
const POOL = ["собираю план дня", "участвую в созвонах", "веду календарь и таск-трекер", "контролирую исполнение", "помогаю в чём-нибудь"];
const SHOWN = 2;
const pickStatuses = () => {
  const a = [...POOL];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a.slice(0, SHOWN);
};
// Всё появляется из размытия по очереди: знак → приветствие → статусы; в конце всё так же уходит в размытие
const AT_LOGO = 100, AT_HELLO = 450, AT_STATUS = 800;
// каждый статус непрерывно проезжает по колесу: выкатывается справа, медленно проплывает через центр, укатывается влево
const STATUS_PASS = 1900;
const AT_EXIT = AT_STATUS + SHOWN * STATUS_PASS;
const EXIT = 600;
const SETTLE = 200, FLY = 750;                 // в конце: знак замирает в итоговой форме, потом логотип перелетает в шапку Доски

function greeting() {
  const h = new Date().getHours();
  const hello = h >= 5 && h < 12 ? "Доброе утро" : h < 18 ? "Добрый день" : h < 23 ? "Добрый вечер" : "Доброй ночи";
  const user = (window as any).Telegram?.WebApp?.initDataUnsafe?.user;
  return `${hello}, ${user?.first_name || "Иван"}`;
}

/** Экран «С01 · 1 Прелоудер»: градиент-видео, знак меняет углы, приветствие и статусы проявляются из размытия по очереди.
    В конце приветствие и статус уходят в размытие, а логотип уменьшается и перелетает на своё место в шапке Доски. */
export function Preloader({ onDone, toBoard = true }: { onDone: () => void; toBoard?: boolean }) {
  const [state, setState] = useState(0);
  const [shown, setShown] = useState({ logo: false, hello: false, status: false });
  const [status, setStatus] = useState(0);
  const [statuses] = useState(pickStatuses);   // один раз на загрузку
  const [exit, setExit] = useState(false);
  const [done, setDone] = useState(false);
  const [leaving, setLeaving] = useState(false);   // фон прелоудера растворяется, логотип летит
  const video = useRef<HTMLVideoElement>(null);
  const brand = useRef<HTMLDivElement>(null);
  const cycle = useRef(0);

  useEffect(() => {
    cycle.current = window.setInterval(() => setState((s) => (s + 1) % STATES.length), STEP);
    return () => clearInterval(cycle.current);
  }, []);

  // перелёт логотипа в шапку Доски; если Доски под прелоудером нет — обычный уход в размытие
  const fly = () => {
    const from = brand.current, to = document.querySelector<HTMLElement>(".board-logo");
    if (!from || !to || !toBoard) { setDone(true); setTimeout(onDone, 420); return; }   // дальше регистрация — логотип не летит, всё уходит в размытие
    const a = from.getBoundingClientRect(), b = to.getBoundingClientRect();
    const k = b.width / a.width;
    document.documentElement.classList.add("logo-flying");   // настоящий логотип в шапке пока прячем
    from.style.transformOrigin = "0 0";
    from.style.transition = `transform ${FLY}ms cubic-bezier(0.65, 0, 0.35, 1), opacity ${FLY}ms ease`;
    from.style.transform = `translate(${b.left - a.left}px, ${b.top - a.top}px) scale(${k})`;
    from.style.opacity = "0.3";
    setLeaving(true);
    setTimeout(() => { document.documentElement.classList.remove("logo-flying"); onDone(); }, FLY + 30);
  };

  useEffect(() => {
    const t: number[] = [];
    const at = (ms: number, fn: () => void) => t.push(window.setTimeout(fn, ms));
    at(AT_LOGO, () => setShown((v) => ({ ...v, logo: true })));
    at(AT_HELLO, () => setShown((v) => ({ ...v, hello: true })));
    at(AT_STATUS, () => setShown((v) => ({ ...v, status: true })));
    // следующий статус — когда предыдущий укатился
    for (let i = 1; i < SHOWN; i++) at(AT_STATUS + i * STATUS_PASS, () => setStatus(i));
    at(AT_EXIT, () => { setExit(true); clearInterval(cycle.current); setState(STATES.length - 1); });   // знак — в итоговую форму
    at(AT_EXIT + SETTLE, fly);
    playGlow(video.current);
    return () => { t.forEach(clearTimeout); document.documentElement.classList.remove("logo-flying"); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onDone]);

  const cls = (on: boolean) => `blur-in${on && !exit ? " is-in" : ""}`;
  return (
    <div className={`preloader${done ? " is-done" : ""}${leaving ? " is-leaving" : ""}`} aria-busy={!done} style={{ backgroundColor: glow.base, backgroundImage: `url(${glow.poster})` }}>
      <video ref={video} className="preloader__glow" disablePictureInPicture controls={false} autoPlay muted loop playsInline preload="auto" poster={glow.poster} aria-hidden="true">
        <source src={glow.webm} type="video/webm" />
        <source src={glow.mp4} type="video/mp4" />
      </video>
      <div className="preloader__center">
        <div className="preloader__hello">
          <div ref={brand} className={`preloader__brand blur-in${shown.logo ? " is-in" : ""}`} role="img" aria-label="Vilar">
          <div className="mark" data-state={STATES[state]} aria-hidden="true"><i className="a" /><i className="b" /><i className="c" /></div>
          <svg className="preloader__wordmark" viewBox="0 0 417 93" aria-hidden="true">
            <path d="M0 0H17.7498L55.1913 81.4414L92.6328 0H98.3419L55.7224 93H42.6195L0 0Z" />
            <path d="M107.702 93V0H125.054V93H107.702Z" />
            <path d="M143.488 93V0H160.84V88.0843H218.33V93H143.488Z" />
            <path d="M234.042 93H228.2L271.086 0H283.151L325.903 93H309.191L296.445 65.3657H246.788L234.042 93ZM248.647 61.2471H294.453L271.484 11.6914L248.647 61.2471Z" />
            <path d="M335.254 93V0H378.895C389.605 0 398.235 2.48 404.785 7.44C411.424 12.3114 414.743 18.7771 414.743 26.8371C414.743 33.3029 412.574 38.7057 408.237 43.0457C403.9 47.3857 397.925 50.3086 390.313 51.8143L417 93H405.847L379.691 52.8771H352.606V93H335.254ZM352.606 47.9614H378.098C386.064 47.9614 392.437 46.1014 397.217 42.3814C401.997 38.5729 404.387 33.3914 404.387 26.8371C404.387 20.2829 401.953 15.0129 397.084 11.0271C392.305 6.95286 385.976 4.91571 378.098 4.91571H352.606V47.9614Z" />
          </svg>
        </div>
          <p className={`preloader__text t-display ${cls(shown.hello)}`}>{greeting()}</p>
        </div>
        <p className="preloader__status t-title-m" role="status">
          {shown.status && <span key={status} className="wheel wheel--pass" style={{ animationDuration: `${STATUS_PASS}ms, ${STATUS_PASS}ms` }}>{statuses[status]}</span>}
        </p>
      </div>
    </div>
  );
}
