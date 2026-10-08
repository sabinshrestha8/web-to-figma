import Image from "next/image";

export const metadata = { title: "Image heavy" };

/** Images in every form the converter maps; each testid is asserted in fidelity.int.test.ts. */
function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <figure className="flex flex-col gap-2">
      {children}
      <figcaption className="text-xs text-slate-500">{label}</figcaption>
    </figure>
  );
}

const BOX = "h-40 w-60 bg-slate-200";
const DATA_SVG =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='40'%3E%3Crect width='40' height='40' rx='8' fill='%2310b981'/%3E%3C/svg%3E";

export default function ImageHeavy() {
  return (
    <main className="bg-white p-10">
      <h1 className="mb-8 text-2xl font-bold text-slate-900">Image heavy</h1>
      <section className="grid grid-cols-5 gap-8">
        <Cell label="png, same aspect">
          <img data-testid="img-png" src="/img/landscape.png" alt="" className={BOX} />
        </Cell>
        <Cell label="object-cover">
          <img data-testid="img-cover" src="/img/photo.jpg" alt="" className={`${BOX} object-cover`} />
        </Cell>
        <Cell label="object-cover, top">
          <img
            data-testid="img-cover-top"
            src="/img/portrait.jpg"
            alt=""
            className={`${BOX} object-cover object-top`}
          />
        </Cell>
        <Cell label="object-contain">
          <img data-testid="img-contain" src="/img/portrait.jpg" alt="" className={`${BOX} object-contain`} />
        </Cell>
        <Cell label="object-fill (stretched)">
          <img data-testid="img-fill" src="/img/portrait.jpg" alt="" className={`${BOX} object-fill`} />
        </Cell>
        <Cell label="object-none">
          <img data-testid="img-none" src="/img/photo.jpg" alt="" className={`${BOX} object-none`} />
        </Cell>
        <Cell label="webp">
          <img data-testid="img-webp" src="/img/photo.webp" alt="" className={`${BOX} object-cover`} />
        </Cell>
        <Cell label="picture (webp source)">
          <picture>
            <source srcSet="/img/photo.webp" type="image/webp" />
            <img data-testid="img-picture" src="/img/photo.jpg" alt="" className={`${BOX} object-cover`} />
          </picture>
        </Cell>
        <Cell label="next/image">
          <Image data-testid="img-next" src="/img/landscape.png" alt="" width={240} height={160} />
        </Cell>
        <Cell label="rounded, bordered">
          <img
            data-testid="img-avatar"
            src="/img/portrait.jpg"
            alt=""
            className="size-40 rounded-full border-4 border-white object-cover shadow-lg ring-1 ring-slate-200"
          />
        </Cell>
        <Cell label="svg as img">
          <img data-testid="img-svg" src="/badge.svg" alt="" className="size-24" />
        </Cell>
        <Cell label="data: url">
          <img data-testid="img-data" src={DATA_SVG} alt="" className="size-10" />
        </Cell>
        <Cell label="broken (404)">
          <img data-testid="img-broken" src="/img/missing.png" alt="" className={BOX} />
        </Cell>
        <Cell label="background cover">
          <div
            data-testid="bg-cover"
            className={`${BOX} rounded-xl bg-cover bg-center`}
            style={{ backgroundImage: "url(/img/photo.jpg)" }}
          />
        </Cell>
        <Cell label="background contain">
          <div
            data-testid="bg-contain"
            className={`${BOX} bg-contain bg-center bg-no-repeat`}
            style={{ backgroundImage: "url(/img/portrait.jpg)" }}
          />
        </Cell>
        <Cell label="background tile">
          <div
            data-testid="bg-tile"
            className={`${BOX} bg-white`}
            style={{ backgroundImage: "url(/img/sprite.png)", backgroundSize: "24px 24px" }}
          />
        </Cell>
        <Cell label="gradient over image">
          <div
            data-testid="bg-layered"
            className={`${BOX} flex items-end bg-cover bg-center p-3`}
            style={{
              backgroundImage:
                "linear-gradient(to top, rgb(15 23 42 / 0.8), transparent), url(/img/landscape.png)",
            }}
          >
            <span className="font-semibold text-white">Caption on a photo</span>
          </div>
        </Cell>
      </section>

      <img data-testid="img-oversize" src="/img/wide.png" alt="" className="mt-10 h-24 w-full object-cover" />

      {/* Below the fold: only loads because capture scrolls the page first. */}
      <div className="h-[1400px]" />
      <img data-testid="img-lazy" src="/img/landscape.png" alt="" loading="lazy" className={BOX} />
    </main>
  );
}
