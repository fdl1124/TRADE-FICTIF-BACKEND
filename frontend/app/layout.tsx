import { Analytics } from "@vercel/analytics/next"
import type { Metadata,Viewport } from "next"
import { Geist,Geist_Mono } from "next/font/google"
import "./globals.css"
const sans=Geist({subsets:["latin"],variable:"--font-geist"});const mono=Geist_Mono({subsets:["latin"],variable:"--font-geist-mono"})
export const metadata:Metadata={title:"Ledger — Trading Simulator",description:"Simulation de trading disciplinée, actions et crypto.",generator:"v0.app"}
export const viewport:Viewport={themeColor:"#0B1018",colorScheme:"dark",width:"device-width",initialScale:1,userScalable:true}
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="fr" className="bg-background dark"><body className={`${sans.variable} ${mono.variable} font-sans antialiased`}>{children}{process.env.NODE_ENV==="production"&&<Analytics/>}</body></html>}
