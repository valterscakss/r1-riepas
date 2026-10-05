'use client';

import type { ReactNode } from 'react';
import { printNode } from '@/client/print';

/* The plain walk-through of the three everyday jobs, with a screenshot of each
   step. Open to everyone — a manual nobody can reach is no manual. */

function Step({ n, title, img, alt, children }: { n: number; title: string; img?: string; alt?: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 16, marginBottom: 22, alignItems: 'flex-start' }}>
      <span style={{ flex: 'none', width: 30, height: 30, borderRadius: '50%', background: 'var(--accent)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 14 }}>{n}</span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 4 }}>{title}</div>
        <div className="muted-2" style={{ fontSize: 14, lineHeight: 1.6 }}>{children}</div>
        {/* eslint-disable-next-line @next/next/no-img-element -- static screenshots that also go to print */}
        {img && <img src={`/help/${img}`} alt={alt ?? title} loading="lazy" style={{ display: 'block', width: '100%', maxWidth: 720, marginTop: 11, border: '1px solid var(--border-2)', borderRadius: 10 }} />}
      </div>
    </div>
  );
}

function Section({ title, lead, note, children }: { title: string; lead: string; note?: ReactNode; children: ReactNode }) {
  return (
    <section style={{ marginBottom: 34 }}>
      <h2 style={{ margin: '0 0 4px', fontSize: 19, fontWeight: 600 }}>{title}</h2>
      <p className="muted" style={{ margin: '0 0 18px', fontSize: 13 }}>{lead}</p>
      {children}
      {note && <div style={{ background: 'var(--accent-soft)', border: '1px solid var(--accent-line)', borderRadius: 10, padding: '12px 14px', fontSize: 13, lineHeight: 1.6 }} className="muted-2">{note}</div>}
    </section>
  );
}

const B = ({ children }: { children: ReactNode }) => <b style={{ fontWeight: 600 }}>{children}</b>;

function HelpBody() {
  return (
    <>
      <Section title="1. Kā pieņemt riepas glabāšanā" lead="No klienta atnākšanas līdz SMS kodam — četri soļi."
        note="Pēc apstiprināšanas noliktavā automātiski parādās uzdevums «Novietot glabāšanā» — riepas fiziski jānoliek norādītajā vietā.">
        <Step n={1} title="Atver sadaļu «Jauna glabāšana»" img="a1-tukss.jpg" alt="Tukša jaunas glabāšanas forma">Sānu izvēlnē spied <B>Jauna glabāšana</B>. Tā ir izcelta ar zilu, jo to lieto visbiežāk.</Step>
        <Step n={2} title="Ievadi numura zīmi un spied «Meklēt»" img="a2-meklet-numuru.jpg" alt="Numura zīmes meklēšana un jauna klienta lauki">Ja klients pie mums jau ir bijis, viņa vārds un telefons aizpildās paši. Ja klients ir jauns, parādās dzeltens lauks — ieraksti tur <B>vārdu</B> (obligāti) un <B>telefonu</B>. Uzņēmumam pārslēdz uz «Uzņēmums».</Step>
        <Step n={3} title="Ievadi riepu datus" img="a3-dati.jpg" alt="Aizpildīti riepu dati un kopsavilkums">Izmērs, ražotājs, daudzums, diski un protektora dziļums. <B>Obligāts ir tikai auto numurs un klienta vārds</B> — izmēru un protektoru var ievadīt vēlāk. Labajā pusē uzreiz redzi kopsavilkumu, automātiski piešķirto <B>vietu</B> un <B>cenu</B>. Vietu var nomainīt, uzspiežot uz tās.</Step>
        <Step n={4} title="Spied «Apstiprināt pieņemšanu»" img="a4-sms-kods.jpg" alt="SMS koda logs pēc apstiprināšanas">Sistēma parāda <B>SMS kodu</B> — iedod to klientam. Ar šo kodu riepas vēlāk var atrast pat tad, ja aizmirsts numurs.</Step>
      </Section>
      <Section title="2. Kā izsniegt riepas klientam" lead="Klients atbrauc pēc riepām — atrodi, izdrukā aktu, izsniedz."
        note={<><B>Sagatavot</B> lieto tad, ja klients brauks <B>mainīt</B> riepas: riepas tiek izņemtas, bet vieta paliek rezervēta jaunajām. Sagatavotās redzamas sadaļā «Sagatavotie».</>}>
        <Step n={1} title="Atver sadaļu «Izsniegt glabāšanu»" img="b1-tukss.jpg" alt="Tukša izsniegšanas forma">Sānu izvēlnē spied <B>Izsniegt glabāšanu</B>.</Step>
        <Step n={2} title="Ievadi SMS kodu vai numura zīmi" img="b2-atrasts.jpg" alt="Atrastās riepas ar darbību pogām">Spied <B>Meklēt</B>. Parādās kartīte ar visu informāciju: vieta, izmērs, ražotājs, protektors un cena.</Step>
        <Step n={3} title="Izdrukā izsniegšanas aktu" img="b3-akts.jpg" alt="Izdrukājamais izsniegšanas akts ar paraksta vietām">Spied <B>⎙ Drukāt</B>. Izdrukā ir viss, ko klients saņem, un <B>divas paraksta vietas</B> — klientam un darbiniekam. Klients paraksta pirms riepu saņemšanas.</Step>
        <Step n={4} title="Spied «Izsniegt riepas»">Apstiprini logu. Vieta kļūst brīva un ieraksts pāriet uz «Izsniegts».</Step>
      </Section>
      <Section title="3. Kā strādā noliktava" lead="Noliktavas darbiniekam viss darāmais ir vienā sarakstā."
        note={<>Ar pogu <B>🔔 Paziņojumi</B> telefonā var ieslēgt paziņojumus — tad par katru jaunu uzdevumu atnāk ziņa, arī tad, ja lietotne ir aizvērta.</>}>
        <Step n={1} title="Atver «Noliktava» → «Darāmie»" img="c1-daramie.jpg" alt="Noliktavas uzdevumu saraksts">
          Sarakstā ir tikai tas, kas <B>vēl nav izdarīts</B>. Cipars blakus izvēlnei rāda, cik uzdevumu gaida. Ir trīs veidu uzdevumi:<br />
          • <span className="badge ok">Novietot glabāšanā</span> — jaunas riepas jānoliek norādītajā vietā<br />
          • <span className="badge warn">Sagatavot riepas</span> — riepas jāizņem no vietas un jāatnes<br />
          • <span className="badge accent">Pasūtījums</span> — brīvs pieprasījums no darbinieka
        </Step>
        <Step n={2} title="Kad izdarīts — spied «✓ Gatavs»">Uzdevums pazūd no saraksta un pāriet uz «Vēsture». Melnais kvadrātiņš blakus nosaukumam ir <B>vieta</B>, uz kuru jāiet. Ar <B>Atvērt ↗</B> var apskatīt pilnu ierakstu, pievienot bildi vai komentāru.</Step>
        <Step n={3} title="Jauns pasūtījums noliktavai" img="c2-jauns-pasutijums.jpg" alt="Jauna pasūtījuma izveide">Cilnē <B>Pasūtīt</B> ieraksti, kas vajadzīgs, un izvēlies, <B>kurp nest</B> — uz veikalu, uz montāžu vai citur. Noliktavas darbinieks to uzreiz redz sarakstā.</Step>
        <Step n={4} title="Pabeigtie uzdevumi" img="c3-izdarits.jpg" alt="Pabeigto uzdevumu vēsture">Cilnē <B>Vēsture</B> redzams viss izdarītais un kas to izdarīja.</Step>
      </Section>
      <Section title="4. Novietnes — vietu karte" lead="Kur kas stāv un kas ir brīvs."
        note={<>Riepas var atrast arī sadaļā <B>Tabula</B> — tur ir viss saraksts ar meklēšanu pēc numura, vārda, telefona vai izmēra. Jaunākie ieraksti ir augšā.</>}>
        <Step n={1} title="Atver «Novietnes»" img="d1-novietnes.jpg" alt="Novietņu karte">
          Katrs kvadrātiņš ir viena vieta. <span className="badge ok">Zaļa</span> — brīva, <span className="badge plain">pelēka</span> — aizņemta,{' '}
          <span className="badge warn">dzeltena</span> — sagatavota maiņai, <span className="badge danger">sarkana</span> — bloķēta.
          Uzspied uz vietas, lai redzētu, kas tur glabājas un šī auto iepriekšējās sezonas.
        </Step>
      </Section>
    </>
  );
}

export function HelpScreen() {
  const print = () => printNode(
    <div style={{ maxWidth: '180mm', margin: '0 auto', fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ fontSize: 20, margin: '0 0 2px' }}>R1 Tires — lietošanas instrukcija</h1>
      <p style={{ margin: '0 0 20px', fontSize: 12 }}>Kā pieņemt riepas, kā tās izsniegt un kā strādā noliktava</p>
      <HelpBody />
    </div>, 400);
  return (
    <div className="page w-900">
      <div className="page-head">
        <div><h1>Lietošanas instrukcija</h1><div className="sub">Kā pieņemt riepas, kā tās izsniegt un kā strādā noliktava</div></div>
        <button className="btn" onClick={print}>⎙ Drukāt instrukciju</button>
      </div>
      <div className="card" style={{ padding: '26px 28px' }}><HelpBody /></div>
    </div>
  );
}
