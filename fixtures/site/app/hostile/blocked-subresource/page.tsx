// A subresource aimed at cloud metadata: the page captures, the request is blocked with a warning.
export default function BlockedSubresource() {
  return (
    <main className="p-8">
      <h1 className="text-2xl font-bold">Blocked subresource</h1>
      {/* biome-ignore lint/performance/noImgElement: plain img is the point of this fixture */}
      <img
        src="http://169.254.169.254/latest/meta-data/icon.png"
        alt="metadata probe"
        width={64}
        height={64}
      />
    </main>
  );
}
