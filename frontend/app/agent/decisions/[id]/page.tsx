import { DecisionAudit } from "@/components/agent/decision-audit"
export default async function DecisionPage({params}:{params:Promise<{id:string}>}){const {id}=await params;return <DecisionAudit id={id}/>}
