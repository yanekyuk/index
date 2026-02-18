import type { Metadata } from "next";
import ClientLayout from "@/components/ClientLayout";
import Footer from "@/components/Footer";

export const metadata: Metadata = {
  title: "About | Index Network",
  description: "Index is a private, intent-driven discovery protocol. Meet your next idea partner.",
};

export default function AboutPage() {
  return (
    <ClientLayout hideFeedback>
      <div className="flex flex-col min-h-[calc(100vh-76px)]">
        <main className="flex-1 flex flex-col justify-end px-6 lg:px-12 pb-[80px] font-sans text-[15px] text-black">
          <div className="max-w-[960px] w-full mx-auto">
          <div className="max-w-[560px]">
            <h1 className="font-garamond text-3xl font-medium text-black mb-6">About us</h1>

            <p className="leading-relaxed mb-2">
              What if you could trust that the right opportunities will find you?
            </p>
            <p className="leading-relaxed mb-6">
              We&apos;re building the protocol for it. Index is where agents match people based on mutual intents—or, shared dreams and schemes. We believe in an internet where your next move isn&apos;t dependent on having a polished brand, and where you can be ambiently optimistic about social discovery.
            </p>
          </div>

          <div className="flex flex-col gap-4">
            <div>
              <h2 className="font-garamond text-xl font-medium text-black mb-1">Team</h2>
              <p><a href="https://x.com/hyperseref" target="_blank" rel="noopener noreferrer" className="underline">Seref Yarar</a>, <a href="https://x.com/serensandikci" target="_blank" rel="noopener noreferrer" className="underline">Seren Sandikci</a>, <a href="https://linkedin.com/in/yanekyuk" target="_blank" rel="noopener noreferrer" className="underline">Yanki Ekin Yuksel</a>, <a href="https://linkedin.com/in/vickygu" target="_blank" rel="noopener noreferrer" className="underline">Vicky Gu</a></p>
            </div>

            <div>
              <h2 className="font-garamond text-xl font-medium text-black mb-1">Investors</h2>
              <p><a href="https://frachtis.com" target="_blank" rel="noopener noreferrer" className="underline">Frachtis</a>, <a href="https://dlab.vc" target="_blank" rel="noopener noreferrer" className="underline">dlab</a>, <a href="https://blueyard.com" target="_blank" rel="noopener noreferrer" className="underline">Blueyard</a>, <a href="https://mesh.xyz" target="_blank" rel="noopener noreferrer" className="underline">Consensys Mesh</a>, <a href="https://imtoken.ventures/" target="_blank" rel="noopener noreferrer" className="underline">imToken</a>, <a href="https://sundao.ventures/" target="_blank" rel="noopener noreferrer" className="underline">SunDAO</a>, <a href="https://x.com/tannedoaksprout" target="_blank" rel="noopener noreferrer" className="underline">Oak</a>, <a href="https://x.com/0xbilly" target="_blank" rel="noopener noreferrer" className="underline">Billy Luedtke</a>, <a href="https://www.linkedin.com/in/zhehao-kobby-chen-8b6a92a5" target="_blank" rel="noopener noreferrer" className="underline">Kobby Chen</a></p>
            </div>

            <div>
              <h2 className="font-garamond text-xl font-medium text-black mb-1">Join us</h2>
              <p>
                Email us at{" "}
                <a href="mailto:hello@index.network" className="underline">hello@index.network</a>
              </p>
            </div>
          </div>
          </div>
        </main>
        <Footer />
      </div>
    </ClientLayout>
  );
}
