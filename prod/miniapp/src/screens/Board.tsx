import { CalendarBoard, CalendarDecisions, useCalendar } from "./CalendarBoard";
import { useLayoutEffect, useRef, useState } from "react";
import { boards, glowFor, load, loadOf, playGlow, stages, today, userInitials, type StageId } from "../data/content";
import { Avatar, IconButton, ListRow, LoadBadge, Mark, Section, Wordmark } from "../ui";
import { useNav } from "../nav";
import { whoop } from "../haptics";
import { MailBoard, useImportedMail } from "./MailBoard";
import { isBrowserTest } from "../api/mailBoard";
import { LiveApprovals, useApprovals } from "./LiveOverview";

/** Доска: три этапа. Сверху на красной подложке — то, что ждёт решения, ниже — то, что Vilar сделал сам. */
export function Board({ stage, onStage }: { stage: StageId; onStage: (s: StageId) => void }) {
  const nav = useNav();
  const data = boards[stage];
  const approvals = useApprovals(isBrowserTest);
  const liveApprovals = isBrowserTest && stage === "approvals";
  const isCalendar = stage === "meetings";
  const calendar = useCalendar(true);
  const heroLoad = isBrowserTest
    ? loadOf(calendar.pending.length + (approvals.data?.rows.length ?? 0))
    : isCalendar && calendar.pending.length ? "red" : load;
  const hero = glowFor(heroLoad);
  const isMail = stage === "mail";
  const mail = useImportedMail();
  const wrap = useRef<HTMLDivElement>(null);
  const glowBox = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [clip, setClip] = useState("");

  // Фон-градиент и активная вкладка — одна фигура: вырезаем её контур по положению вкладки.
  // При смене этапа вырез плавно переезжает к новой вкладке (считаем покадрово, чтобы работало в любом браузере).
  const cur = useRef<{ x: number; w: number } | null>(null);
  const raf = useRef(0);
  useLayoutEffect(() => {
    const draw = (x: number, w: number) => {
      const box = glowBox.current, root = wrap.current, tab = tabRefs.current[stage];
      if (!box || !root || !tab) return;
      const W = root.offsetWidth, H = box.offsetHeight, th = tab.offsetHeight, R = 32, r = 16;
      // на узких экранах крайняя вкладка стоит близко к краю: большое скругление уменьшаем, чтобы язычок вкладки не вылезал за него
      const L = Math.max(0, Math.min(R, x - r)), Rr = Math.max(0, Math.min(R, W - (x + w) - r));
      setClip(`path('M0 ${th + L} A${L} ${L} 0 0 1 ${L} ${th} L${x - r} ${th} A${r} ${r} 0 0 0 ${x} ${th - r} L${x} ${r} A${r} ${r} 0 0 1 ${x + r} 0 L${x + w - r} 0 A${r} ${r} 0 0 1 ${x + w} ${r} L${x + w} ${th - r} A${r} ${r} 0 0 0 ${x + w + r} ${th} L${W - Rr} ${th} A${Rr} ${Rr} 0 0 1 ${W} ${th + Rr} L${W} ${H} L0 ${H} Z')`);
    };
    const target = () => {
      const tab = tabRefs.current[stage], root = wrap.current;
      if (!tab || !root) return null;
      const rb = root.getBoundingClientRect(), tb = tab.getBoundingClientRect();
      return { x: tb.left - rb.left, w: tb.width };
    };
    const snap = () => { const t = target(); if (t) { cur.current = t; draw(t.x, t.w); } };
    const to = target();
    const from = cur.current;
    cancelAnimationFrame(raf.current); raf.current = 0;
    if (!to) return;
    if (!from || matchMedia("(prefers-reduced-motion: reduce)").matches) snap();
    else {
      const t0 = performance.now(), D = 380, ease = (k: number) => 1 - Math.pow(1 - k, 3);
      const step = (now: number) => {
        const k = Math.min(1, (now - t0) / D), e = ease(k);
        const x = from.x + (to.x - from.x) * e, w = from.w + (to.w - from.w) * e;
        cur.current = { x, w }; draw(x, w);
        raf.current = k < 1 ? requestAnimationFrame(step) : 0;
      };
      raf.current = requestAnimationFrame(step);
    }
    const ro = new ResizeObserver(() => { if (!raf.current) snap(); });   // во время переезда не перебиваем анимацию
    if (wrap.current) ro.observe(wrap.current);
    document.fonts?.ready.then(() => { if (!raf.current) snap(); });
    return () => { ro.disconnect(); cancelAnimationFrame(raf.current); raf.current = 0; };
  }, [stage]);

  return (
    <div className="screen screen--surface">
      <div className="scroll">
        <div className="board-date"><span className="date-chip t-caption-medium">{isCalendar || isBrowserTest ? new Date().toLocaleDateString("ru-RU", {day:"numeric", month:"long", timeZone:"Europe/Moscow"}) : today}</span></div>
        <header className="header header--board">
          <IconButton icon="bell" label="Уведомления" onClick={() => nav("screen:notifications")} />
          {/* логотип из прелоудера: знак + надпись, высота 18, прозрачность 30% */}
          <span className="board-logo" role="img" aria-label="Vilar"><Mark width={26.6} color="#fff" /><Wordmark height={13.7} color="#fff" /></span>
          <Avatar initials={isBrowserTest ? "А" : userInitials} onClick={() => nav("screen:profile")} />
        </header>

        <div ref={wrap} style={{ position: "relative" }}>
          <div className="stages">
            <div className="stages__row" role="tablist" aria-label="Этапы">
              {stages.map((s) => (
                <button key={s.id} ref={(el) => (tabRefs.current[s.id] = el)} type="button" role="tab" aria-selected={s.id === stage}
                        className={`stage-tab t-body-m-medium${s.id === stage ? " is-active" : ""}`} onClick={() => { if (s.id !== stage) whoop(); onStage(s.id); }}>
                  {s.label}
                  {s.id !== stage && (s.id === "mail"
                    ? mail.messages && <LoadBadge count={mail.messages.length} />
                    : s.id === "meetings" ? calendar.meetings && <LoadBadge count={calendar.pending.length} /> : isBrowserTest ? approvals.data && <LoadBadge count={approvals.data.rows.length} /> : <LoadBadge count={s.count} />)}
                </button>
              ))}
            </div>
          </div>

          {/* единая фигура: вкладка + красная подложка; фон — видео с анимированным градиентом.
              При смене этапа вкладка переезжает (меняется контур), видео не перезапускается. */}
          <div ref={glowBox} className="hero-glow" data-load={heroLoad} style={{ top: 12, bottom: -40, clipPath: clip || undefined, backgroundImage: `url(${hero.poster})` }}>
            <video ref={playGlow} disablePictureInPicture controls={false} autoPlay muted loop playsInline preload="auto" poster={hero.poster} aria-hidden="true">
              <source src={hero.webm} type="video/webm" />
              <source src={hero.mp4} type="video/mp4" />
            </video>
          </div>

          <div className="hero">
            <div key={stage} className="hero__body stage-content" style={{ gap: 28 }}>
              <div className="hero__count">
                <span className="t-hero-number">{isMail ? mail.messages?.length ?? "—" : isCalendar ? (calendar.meetings ? calendar.pending.length : "—") : liveApprovals ? approvals.data?.rows.length ?? "—" : data.hero.count}</span>
                <span className="t-body-l">{isMail ? "письма из Outlook" : isCalendar ? (calendar.pending.length === 1 ? "решение по встрече" : "решения по встречам") : liveApprovals ? "на согласовании" : data.hero.label}</span>
              </div>
              <div className="hero__rows">
                {isCalendar && <CalendarDecisions {...calendar} />}
                {!isMail && !isCalendar && !liveApprovals && data.urgent.map((r) => <ListRow key={r.title} urgent title={r.title} subtitle={r.subtitle} status={r.status} onClick={() => r.open && nav(r.open)} />)}
              </div>
            </div>
          </div>
        </div>

        <div key={stage} className="board-sheet stage-content">
          {isMail ? <MailBoard mail={mail} /> : isCalendar ? <CalendarBoard {...calendar} /> : liveApprovals ? <LiveApprovals {...approvals} /> : data.sections.map((s) => (
            <Section key={s.title} title={s.title} vilar={s.vilar}>
              {s.rows.map((r) => <ListRow key={r.title} urgent={r.urgent} title={r.title} subtitle={r.subtitle} status={r.status} onClick={() => r.open && nav(r.open)} />)}
            </Section>
          ))}
        </div>
      </div>
    </div>
  );
}
