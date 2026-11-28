import { CalendarBoard, CalendarDecisions, useCalendar } from "./CalendarBoard";
import { useLayoutEffect, useRef, useState } from "react";
import { boards, decisionsWaiting, glowFor, load, loadForced, loadOf, playGlow, stages, today, userInitials, type StageId } from "../data/content";
import { Avatar, IconButton, ListRow, LoadBadge, Mark, Section, Wordmark } from "../ui";
import { useNav } from "../nav";
import { whoop } from "../haptics";
import { MailSections, MailUrgent, mailHeroLabel, useMail } from "./MailStage";
import { hasAccountLaunch } from "../api/mailBoard";
import { ApprovalUrgent, LiveApprovals, useApprovals } from "./LiveOverview";
import { useSelf } from "../api/tracker";
import { useAttention } from "../api/attention";
import { useFocus } from "../focus";
import { rowSheet } from "../data/sheets";
import { advanceDay, useDay } from "../api/day";
import { DayTasks, DayUrgent } from "./DayTasks";

// Счётчики этапов с прошлого показа Доски. Данные каждый раз перечитываются с сервера, и без этого вкладки
// сначала стоят без счётчиков, а потом раздвигаются — вырез активной вкладки успевал встать не на своё место.
const seenCounts: Partial<Record<StageId, number>> = {};

/** Доска: три этапа. Сверху на красной подложке — то, что ждёт решения, ниже — то, что Vilar сделал сам. */
export function Board({ stage, onStage, initialMailTicket }: { stage: StageId; onStage: (s: StageId) => void; initialMailTicket?: string }) {
  const nav = useNav();
  const data = boards[stage];
  const self = useSelf(hasAccountLaunch);
  const approvals = useApprovals(hasAccountLaunch, self.name);
  const [openedApproval, openApproval] = useState<string | null>(null);
  const liveApprovals = hasAccountLaunch && stage === "approvals";
  // без входа (макетный режим) все три этапа показывают макетные данные; живые почта и календарь — только после входа
  const isCalendar = hasAccountLaunch && stage === "meetings";
  const calendar = useCalendar(hasAccountLaunch);
  // почта — из тикетов mail и в макете, и после входа (см. MailStage)
  const isMail = stage === "mail";
  const mail = useMail();
  const [openedMail, openMail] = useState<string | null>(initialMailTicket ?? null);
  // цвет фона — по числу карточек, которые ждут руководителя на всех этапах
  const heroLoad = hasAccountLaunch
    ? loadOf(calendar.pending.length + (approvals.needs ?? 0) + (mail.needs ?? 0))
    : loadForced ? load : loadOf(decisionsWaiting - boards.mail.urgent.length + (mail.needs ?? 0));
  const hero = glowFor(heroLoad);
  // учебный день показа: дата в шапке — с сервера; после утверждения протокола нажатие на неё проматывает 48 часов
  const day = useDay(hasAccountLaunch);
  const [openedDay, openDay] = useState<string | null>(null);
  const [winding, setWinding] = useState(false);
  const [dayNote, setDayNote] = useState<string | null>(null);
  const wind = async () => {
    if (winding) return;
    whoop(); setWinding(true); setDayNote(null);
    const error = await advanceDay();
    setWinding(false);
    if (error) { setDayNote(error); setTimeout(() => setDayNote(null), 2600); }
  };
  const dateText = (d: Date) => d.toLocaleDateString("ru-RU", { day: "numeric", month: "long", timeZone: "Europe/Moscow" });
  // уведомление просит открыть конкретную карточку — открываем её шторку, как только данные на месте
  useFocus("mail", (id) => { if (!mail.tickets?.some((t) => t.id === id)) return false; openMail(id); return true; }, [mail.tickets]);
  useFocus("approval", (id) => { if (!approvals.data?.rows.some((r) => r.step_id === id)) return false; openApproval(id); return true; }, [approvals.data]);
  useFocus("meeting", (id) => { if (!calendar.meetings?.some((m) => m.id === id)) return false; calendar.select(id); return true; }, [calendar.meetings]);
  // число на вкладке — сколько карточек этапа ждут решения руководителя. После входа его даёт сервер (GET ./api/attention);
  // пока сервер не ответил — прошлые числа; если такого адреса на сервере нет — считаем сами по карточкам этапов
  const attention = useAttention(hasAccountLaunch);
  const own: Partial<Record<StageId, number>> = {
    // у писем со старого адреса решений нет — там число писем
    mail: mail.mode === "legacy" ? mail.shown : mail.needs, meetings: calendar.meetings ? calendar.pending.length : undefined, approvals: approvals.needs,
  };
  const counts: Partial<Record<StageId, number>> = !hasAccountLaunch
    ? { mail: mail.needs, approvals: boards.approvals.urgent.length, meetings: boards.meetings.urgent.length }
    : attention.status === "ok" ? { mail: attention.data?.mail ?? own.mail, meetings: attention.data?.meetings ?? own.meetings, approvals: attention.data?.tasks ?? own.approvals }
    : attention.status === "missing" ? own : {};
  (Object.keys(counts) as StageId[]).forEach((k) => { if (counts[k] !== undefined) seenCounts[k] = counts[k]; });
  const countOf = (id: StageId) => counts[id] ?? seenCounts[id];
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
        if (k < 1) raf.current = requestAnimationFrame(step);
        else { raf.current = 0; snap(); }   // пока вырез ехал, вкладка могла сдвинуться (пришли счётчики) — встаём по её настоящему месту
      };
      raf.current = requestAnimationFrame(step);
    }
    const ro = new ResizeObserver(() => { if (!raf.current) snap(); });   // во время переезда не перебиваем анимацию
    if (wrap.current) ro.observe(wrap.current);
    // счётчики на вкладках в живом режиме приходят позже и меняют ширину вкладок — вырез должен встать заново
    Object.values(tabRefs.current).forEach((el) => el && ro.observe(el));
    document.fonts?.ready.then(() => { if (!raf.current) snap(); });
    return () => { ro.disconnect(); cancelAnimationFrame(raf.current); raf.current = 0; };
  }, [stage]);

  return (
    <div className="screen screen--surface">
      <div className="scroll">
        <div className="board-date">
          {hasAccountLaunch && day?.canAdvance
            ? <button type="button" className={`date-chip date-chip--button t-caption-medium${winding ? " is-winding" : ""}`} aria-label="Перейти на два дня вперёд" onClick={wind}>{dateText(day.now ?? new Date())}</button>
            : <span key={day?.now?.getTime() ?? 0} className={`date-chip t-caption-medium${day?.now ? " date-chip--moved" : ""}`}>{hasAccountLaunch ? dateText(day?.now ?? new Date()) : today}</span>}
          {dayNote && <span role="status" className="date-note t-caption-medium">{dayNote}</span>}
        </div>
        <header className="header header--board">
          <IconButton icon="bell" label="Уведомления" onClick={() => nav("screen:notifications")} />
          {/* логотип из прелоудера: знак + надпись, высота 18, прозрачность 30% */}
          <span className="board-logo" role="img" aria-label="Vilar"><Mark width={26.6} color="#fff" /><Wordmark height={13.7} color="#fff" /></span>
          <Avatar initials={hasAccountLaunch ? self.initials : userInitials} onClick={() => nav("screen:profile")} />
        </header>

        <div ref={wrap} style={{ position: "relative" }}>
          <div className="stages">
            <div className="stages__row" role="tablist" aria-label="Этапы">
              {stages.map((s) => (
                <button key={s.id} ref={(el) => (tabRefs.current[s.id] = el)} type="button" role="tab" aria-selected={s.id === stage}
                        className={`stage-tab t-body-m-medium${s.id === stage ? " is-active" : ""}`} onClick={() => { if (s.id !== stage) whoop(); onStage(s.id); }}>
                  {s.label}
                  {/* число на вкладке — сколько карточек этапа ждут решения; красный кружок — только когда их больше нуля.
                      Пока число не пришло — прошлое значение; если его ещё не было — невидимое место под счётчик, чтобы вкладки не сдвигались */}
                  {s.id !== stage && (countOf(s.id) === undefined ? <span style={{ display: "inline-flex", visibility: "hidden" }}><LoadBadge count={0} /></span>
                    : countOf(s.id)! > 0 && <LoadBadge count={countOf(s.id)!} />)}
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
                <span className="t-hero-number">{isMail || hasAccountLaunch ? countOf(stage) ?? "—" : data.hero.count}</span>
                <span className="t-body-l">{isMail ? (mail.mode === "legacy" ? "письма из Outlook" : mailHeroLabel(countOf("mail") ?? mail.needs ?? 0)) : isCalendar ? ((countOf("meetings") ?? calendar.pending.length) === 1 ? "решение по встрече" : "решения по встречам") : liveApprovals ? "на согласовании" : data.hero.label}</span>
              </div>
              <div className="hero__rows">
                {isMail && <MailUrgent mail={mail} onOpen={openMail} />}
                {liveApprovals && <DayUrgent day={day} onOpen={openDay} />}
                {liveApprovals && <ApprovalUrgent approvals={approvals} onOpen={openApproval} />}
                {isCalendar && <CalendarDecisions {...calendar} />}
                {!isMail && !isCalendar && !liveApprovals && data.urgent.map((r) => <ListRow key={r.title} urgent title={r.title} subtitle={r.subtitle} status={r.status} onClick={() => nav(r.open ?? rowSheet(r))} />)}
              </div>
            </div>
          </div>
        </div>

        <div key={stage} className="board-sheet stage-content">
          {isMail ? <MailSections mail={mail} opened={openedMail} onOpen={openMail} /> : isCalendar ? <CalendarBoard {...calendar} /> : liveApprovals ? <><DayTasks day={day} opened={openedDay} onOpen={openDay} /><LiveApprovals approvals={approvals} opened={openedApproval} onOpen={openApproval} /></> : data.sections.map((s) => (
            <Section key={s.title} title={s.title} vilar={s.vilar}>
              {s.rows.map((r) => <ListRow key={r.title} urgent={r.urgent} title={r.title} subtitle={r.subtitle} status={r.status} onClick={() => nav(r.open ?? rowSheet(r))} />)}
            </Section>
          ))}
        </div>
      </div>
    </div>
  );
}
