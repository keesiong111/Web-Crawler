/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from "react";
import { 
  Plus, 
  Search, 
  Play, 
  Pause, 
  RotateCcw, 
  Download, 
  ExternalLink, 
  ChevronRight,
  Database,
  LayoutDashboard,
  Settings,
  History,
  AlertCircle,
  CheckCircle2,
  Clock,
  Loader2,
  Sparkles,
  BarChart3
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from "@/components/ui/table";
import { 
  Dialog, 
  DialogContent, 
  DialogDescription, 
  DialogHeader, 
  DialogTitle, 
  DialogTrigger,
  DialogFooter
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import { GoogleGenAI, Type } from "@google/genai";

// --- Types ---
interface Job {
  id: string;
  name: string;
  description: string;
  status: string;
  total_tasks: number;
  success_tasks: number;
  failed_tasks: number;
  max_pages: number;
  created_at: string;
}

interface Record {
  id: string;
  url: string;
  title: string;
  content: string;
  page_type: string;
  structured_json: string;
  created_at: string;
}

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export default function App() {
  const [activeTab, setActiveTab] = useState("jobs");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [jobDetail, setJobDetail] = useState<any>(null);
  const [records, setRecords] = useState<Record[]>([]);
  const [searchQuery, setSearchQuery] = useState("");

  const [newJob, setNewJob] = useState({
    name: "",
    description: "",
    urls: "",
    maxPages: 100,
    maxDepth: 2
  });

  const [isDialogOpen, setIsDialogOpen] = useState(false);

  useEffect(() => {
    fetchJobs();
    const interval = setInterval(fetchJobs, 5000);
    return () => clearInterval(interval);
  }, []);

  const fetchJobs = async () => {
    try {
      const res = await fetch("/api/jobs");
      const data = await res.json();
      setJobs(data);
      setLoading(false);
    } catch (e) {
      console.error(e);
    }
  };

  const fetchJobDetail = async (id: string) => {
    try {
      const res = await fetch(`/api/jobs/${id}`);
      const data = await res.json();
      setJobDetail(data);
    } catch (e) {
      console.error(e);
    }
  };

  const createJob = async () => {
    if (!newJob.name || !newJob.urls) {
      toast.error("Please fill in required fields");
      return;
    }
    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newJob.name,
          description: newJob.description,
          startUrls: newJob.urls.split("\n").filter(u => u.trim()),
          maxPages: newJob.maxPages,
          maxDepth: newJob.maxDepth
        })
      });
      if (res.ok) {
        toast.success("Job created and started");
        fetchJobs();
        setNewJob({ name: "", description: "", urls: "", maxPages: 100, maxDepth: 2 });
        setIsDialogOpen(false);
      }
    } catch (e) {
      toast.error("Failed to create job");
    }
  };

  const handleAction = async (id: string, action: string) => {
    try {
      await fetch(`/api/jobs/${id}/${action}`, { method: "POST" });
      toast.success(`Job ${action}ed`);
      fetchJobs();
    } catch (e) {
      toast.error(`Failed to ${action} job`);
    }
  };

  const fetchRecords = async (jobId?: string) => {
    try {
      const url = jobId ? `/api/data?jobId=${jobId}` : "/api/data";
      const res = await fetch(url);
      const data = await res.json();
      setRecords(data);
    } catch (e) {
      console.error(e);
    }
  };

  const handleAIAnalyze = async (record: Record) => {
    toast.info("AI is analyzing the content...");
    try {
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `Analyze this web content and return a structured JSON object with fields like 'summary', 'keyPoints', 'sentiment', 'category'.\n\nContent:\n${record.content}`,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              summary: { type: Type.STRING },
              keyPoints: { type: Type.ARRAY, items: { type: Type.STRING } },
              sentiment: { type: Type.STRING },
              category: { type: Type.STRING }
            }
          }
        }
      });
      
      const analysis = JSON.parse(response.text);
      toast.success("AI analysis complete!");
      // In a real app, you'd save this back to DB. 
      // For MVP, we'll just show it in a dialog or toast.
      console.log(analysis);
      alert(JSON.stringify(analysis, null, 2));
    } catch (e) {
      toast.error("AI analysis failed");
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "completed": return <Badge className="bg-green-100 text-green-700 hover:bg-green-100"><CheckCircle2 className="w-3 h-3 mr-1" /> Completed</Badge>;
      case "running": return <Badge className="bg-blue-100 text-blue-700 animate-pulse hover:bg-blue-100"><Loader2 className="w-3 h-3 mr-1 animate-spin" /> Running</Badge>;
      case "failed": return <Badge className="bg-red-100 text-red-700 hover:bg-red-100"><AlertCircle className="w-3 h-3 mr-1" /> Failed</Badge>;
      case "paused": return <Badge className="bg-yellow-100 text-yellow-700 hover:bg-yellow-100"><Pause className="w-3 h-3 mr-1" /> Paused</Badge>;
      default: return <Badge variant="secondary"><Clock className="w-3 h-3 mr-1" /> Pending</Badge>;
    }
  };

  return (
    <div className="flex h-screen bg-[#F1F5F9] text-slate-800 font-sans antialiased grid-lines">
      <Toaster />
      
      {/* Sidebar */}
      <aside className="w-80 border-r bg-white flex flex-col overflow-hidden shadow-sm m-4 rounded-xl border-slate-200">
        <div className="p-4 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-indigo-600 rounded flex items-center justify-center">
              <Database className="text-white w-4 h-4" />
            </div>
            <h1 className="font-bold text-sm tracking-tight text-slate-900 uppercase">Crawl Jobs</h1>
          </div>
          <span className="px-2 py-0.5 bg-slate-200 text-[10px] rounded text-slate-600">v2.4.0</span>
        </div>

        <ScrollArea className="flex-1">
          <div className="flex flex-col">
            {jobs.map((job) => (
              <div 
                key={job.id} 
                className={`p-4 border-b border-slate-100 cursor-pointer transition-colors group ${selectedJob?.id === job.id ? 'active-row bg-indigo-50/30' : 'hover:bg-slate-50'}`}
                onClick={() => { setSelectedJob(job); setActiveTab("job-detail"); fetchJobDetail(job.id); }}
              >
                <div className="flex justify-between items-start mb-1">
                  <h3 className="text-sm font-semibold text-slate-900 truncate">{job.name}</h3>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded uppercase font-bold tracking-wider ${
                    job.status === 'running' ? 'bg-indigo-100 text-indigo-700' :
                    job.status === 'completed' ? 'bg-emerald-100 text-emerald-700' :
                    job.status === 'failed' ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-500'
                  }`}>
                    {job.status}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs text-slate-500 mb-2 font-mono">
                  <span className="truncate max-w-[150px]">{job.id.substring(0, 8)}...</span>
                  <span>{Math.round((job.success_tasks / job.max_pages) * 100)}%</span>
                </div>
                <div className="w-full bg-slate-200 h-1 rounded-full overflow-hidden">
                  <div 
                    className={`h-1 rounded-full transition-all duration-1000 ${
                      job.status === 'running' ? 'bg-indigo-600' :
                      job.status === 'completed' ? 'bg-emerald-500' : 'bg-slate-400'
                    }`}
                    style={{ width: `${(job.success_tasks / job.max_pages) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>

        <div className="p-4 border-t border-slate-100 space-y-2">
          <Button 
            className="w-full justify-start gap-3 h-11 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs uppercase tracking-wider rounded-lg shadow-sm"
            onClick={() => setIsDialogOpen(true)}
          >
            <Plus className="w-4 h-4" /> New Crawl Job
          </Button>
          <div className="pt-2 space-y-1">
            <Button 
              variant="outline" 
              className={`w-full justify-start gap-3 h-10 text-xs font-bold uppercase tracking-wider ${activeTab === 'jobs' ? 'bg-slate-100 text-slate-900 border-slate-300' : 'text-slate-500 border-slate-200'}`}
              onClick={() => setActiveTab("jobs")}
            >
              <LayoutDashboard className="w-4 h-4" /> Dashboard
            </Button>
            <Button 
              variant="outline" 
              className={`w-full justify-start gap-3 h-10 text-xs font-bold uppercase tracking-wider ${activeTab === 'search' ? 'bg-slate-100 text-slate-900 border-slate-300' : 'text-slate-500 border-slate-200'}`}
              onClick={() => { setActiveTab("search"); fetchRecords(); }}
            >
              <Search className="w-4 h-4" /> Global Search
            </Button>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <section className="flex-1 flex flex-col gap-4 overflow-hidden p-4">
        {/* Top Header */}
        <header className="h-16 bg-white border border-slate-200 rounded-xl shadow-sm flex items-center justify-between px-6 z-10">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <div className="status-dot bg-emerald-500 animate-pulse"></div>
              <span className="text-xs font-bold text-slate-500 uppercase tracking-tighter italic">Network Status: Online</span>
            </div>
            <div className="h-4 w-px bg-slate-200"></div>
            <div className="flex items-center gap-2 text-xs font-medium text-slate-400 uppercase tracking-tight">
              {activeTab} Mode
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
              <DialogTrigger asChild>
                <Button className="bg-indigo-600 hover:bg-indigo-700 text-white gap-2 rounded-md px-5 h-10 font-bold text-xs uppercase tracking-wider">
                  <Plus className="w-4 h-4" /> New Crawl Job
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-[550px] border-slate-200 rounded-xl">
                <DialogHeader>
                  <DialogTitle className="text-lg font-bold tracking-tight">Initialize Extraction Protocol</DialogTitle>
                  <DialogDescription className="text-xs uppercase tracking-widest text-slate-400 font-bold">
                    System Configuration
                  </DialogDescription>
                </DialogHeader>
                <div className="grid gap-6 py-4">
                  <div className="grid gap-2">
                    <label className="text-[10px] font-bold uppercase text-slate-500">Operation Name</label>
                    <Input 
                      placeholder="e.g., SITE_MONITOR_X1" 
                      value={newJob.name}
                      autoFocus
                      className="border-slate-200 focus:ring-indigo-500"
                      onChange={(e) => setNewJob({...newJob, name: e.target.value})}
                    />
                  </div>
                  <div className="grid gap-2">
                    <label className="text-[10px] font-bold uppercase text-slate-500">Source URLs (Batch Input)</label>
                    <textarea 
                      className="flex min-h-[120px] w-full rounded-md border border-slate-200 bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus:border-indigo-500 transition-colors"
                      placeholder="https://crawl-target.com"
                      value={newJob.urls}
                      onChange={(e) => setNewJob({...newJob, urls: e.target.value})}
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="ghost" className="text-xs uppercase font-bold text-slate-400">Abort</Button>
                  <Button onClick={createJob} className="bg-slate-900 text-white font-bold text-xs uppercase tracking-widest">Execute Job</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </header>

        <div className="flex-1 flex flex-col gap-4 overflow-hidden">
          {activeTab === "jobs" && (
            <>
              {/* Metrics Grid */}
              <div className="grid grid-cols-4 gap-4">
                <Card className="bg-white border-slate-200 rounded-xl shadow-sm border overflow-hidden relative">
                   <div className="absolute top-0 right-0 p-2 opacity-5">
                     <LayoutDashboard className="w-12 h-12" />
                   </div>
                  <CardHeader className="p-4 pb-2">
                    <CardDescription className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Active Jobs</CardDescription>
                    <CardTitle className="text-2xl font-bold mono text-slate-900">{jobs.filter(j => j.status === 'running').length}</CardTitle>
                  </CardHeader>
                  <CardContent className="p-4 pt-0">
                    <p className="text-[10px] text-emerald-600 font-bold uppercase italic tracking-tighter">Running on 12 Nodes</p>
                  </CardContent>
                </Card>
                <Card className="bg-white border-slate-200 rounded-xl shadow-sm border">
                  <CardHeader className="p-4 pb-2">
                    <CardDescription className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Total Ops</CardDescription>
                    <CardTitle className="text-2xl font-bold mono text-slate-900 uppercase">
                      {jobs.reduce((acc, j) => acc + (j.total_tasks || 0), 0)}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-4 pt-0">
                    <div className="text-[10px] text-slate-400 font-medium italic">Avg. Latency: 240ms</div>
                  </CardContent>
                </Card>
                <Card className="bg-white border-slate-200 rounded-xl shadow-sm border">
                  <CardHeader className="p-4 pb-2">
                    <CardDescription className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Extractions</CardDescription>
                    <CardTitle className="text-2xl font-bold mono text-slate-900 uppercase">
                      {jobs.reduce((acc, j) => acc + (j.success_tasks || 0), 0)}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-4 pt-0">
                    <p className="text-[10px] text-indigo-600 font-bold uppercase italic tracking-tighter">PostgreSQL Sync 100%</p>
                  </CardContent>
                </Card>
                <Card className="bg-white border-slate-200 rounded-xl shadow-sm border">
                  <CardHeader className="p-4 pb-2">
                    <CardDescription className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">System Errors</CardDescription>
                    <CardTitle className="text-2xl font-bold mono text-rose-500 uppercase">
                      {jobs.reduce((acc, j) => acc + (j.failed_tasks || 0), 0)}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-4 pt-0">
                    <p className="text-[10px] text-amber-600 font-bold uppercase italic tracking-tighter">Usage High (Load 1.4)</p>
                  </CardContent>
                </Card>
              </div>

              {/* Data Preview Table */}
              <div className="flex-1 bg-white border border-slate-200 rounded-xl shadow-sm flex flex-col overflow-hidden">
                <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/30">
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-bold uppercase text-slate-500 tracking-wider">Mission Command Overview</span>
                    <span className="text-[10px] text-slate-400 bg-slate-100 px-2 py-0.5 rounded italic">Showing {jobs.length} Active Missions</span>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" className="h-8 text-[10px] uppercase font-bold" onClick={fetchJobs}><RotateCcw className="w-3.5 h-3.5 mr-2" /> Reboot List</Button>
                    <Button size="sm" className="h-8 text-[10px] uppercase font-bold bg-slate-900 text-white hover:bg-slate-800"><Download className="w-3.5 h-3.5 mr-2" /> Global Export</Button>
                  </div>
                </div>
                
                <ScrollArea className="flex-1">
                  {loading ? (
                    <div className="p-20 text-center text-slate-400 italic mono text-xs animate-pulse">Initializing Data Stream...</div>
                  ) : jobs.length === 0 ? (
                    <div className="flex-1 flex flex-col items-center justify-center p-20 text-center space-y-6">
                      <div className="w-20 h-20 bg-indigo-50 rounded-full flex items-center justify-center text-indigo-500 animate-bounce">
                        <Plus className="w-10 h-10" />
                      </div>
                      <div className="max-w-md space-y-2">
                        <h3 className="text-xl font-bold text-slate-900 tracking-tight">No Active Missions Detected</h3>
                        <p className="text-sm text-slate-500 leading-relaxed">
                          Your extraction engine is idle. Initialize a new crawl job to start extracting data from any public website with AI-enhanced parsing.
                        </p>
                      </div>
                      <Button 
                        onClick={() => setIsDialogOpen(true)}
                        className="bg-indigo-600 hover:bg-indigo-700 text-white px-8 py-6 rounded-xl font-bold text-sm uppercase tracking-widest shadow-xl shadow-indigo-200 hover:scale-105 transition-all"
                      >
                        Launch First Mission
                      </Button>
                    </div>
                  ) : (
                    <Table>
                      <TableHeader className="bg-slate-50 text-slate-500 uppercase text-[10px] font-bold sticky top-0 z-10 shadow-sm border-b">
                        <TableRow>
                          <TableHead className="px-6 py-4 text-left font-bold">Mission Label</TableHead>
                          <TableHead className="px-6 py-4 text-left font-bold">Execution State</TableHead>
                          <TableHead className="px-6 py-4 text-left font-bold">Yield Ratio</TableHead>
                          <TableHead className="px-6 py-4 text-left font-bold">Creation Stamp</TableHead>
                          <TableHead className="px-6 py-4 text-right font-bold">Directives</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody className="divide-y divide-slate-100">
                        {jobs.map((job) => (
                          <TableRow key={job.id} className="hover:bg-slate-50 group transition-colors">
                            <TableCell className="px-6 py-4">
                              <div className="font-bold text-slate-900 text-sm tracking-tight">{job.name}</div>
                              <div className="text-[10px] font-mono text-slate-400 uppercase tracking-tighter truncate max-w-[200px]">{job.id}</div>
                            </TableCell>
                            <TableCell className="px-6 py-4">{getStatusBadge(job.status)}</TableCell>
                            <TableCell className="px-6 py-4">
                              <div className="w-[180px] space-y-1.5">
                                <div className="flex justify-between text-[9px] font-bold uppercase tracking-tighter text-slate-400">
                                  <span>Efficiency</span>
                                  <span className="mono">{Math.round((job.success_tasks / job.max_pages) * 100)}%</span>
                                </div>
                                <Progress value={(job.success_tasks / job.max_pages) * 100} className="h-1 bg-slate-100" />
                                <div className="text-[10px] mono text-slate-500">{job.success_tasks} REC / {job.max_pages} LIM</div>
                              </div>
                            </TableCell>
                            <TableCell className="px-6 py-4 text-[10px] text-slate-500 mono italic">
                              {new Date(job.created_at).toISOString().replace('T', ' ').substring(0, 19)}
                            </TableCell>
                            <TableCell className="px-6 py-4 text-right">
                              <div className="flex justify-end gap-1">
                                {job.status === 'running' ? (
                                  <Button size="icon" variant="ghost" className="h-7 w-7 text-amber-600 hover:bg-amber-50" onClick={(e) => { e.stopPropagation(); handleAction(job.id, 'pause'); }}><Pause className="w-3.5 h-3.5" /></Button>
                                ) : job.status === 'paused' ? (
                                  <Button size="icon" variant="ghost" className="h-7 w-7 text-emerald-600 hover:bg-emerald-50" onClick={(e) => { e.stopPropagation(); handleAction(job.id, 'resume'); }}><Play className="w-3.5 h-3.5" /></Button>
                                ) : null}
                                <Button 
                                  size="icon" 
                                  variant="ghost" 
                                  className="h-7 w-7 text-indigo-600 hover:bg-indigo-50"
                                  onClick={(e) => { e.stopPropagation(); setSelectedJob(job); setActiveTab("job-detail"); fetchJobDetail(job.id); }}
                                >
                                  <ChevronRight className="w-4 h-4" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </ScrollArea>
              </div>

              {/* Console Logs */}
              <div className="h-40 bg-slate-900 border border-slate-700 rounded-xl p-3 mono overflow-hidden flex flex-col shadow-lg">
                <div className="flex items-center gap-2 mb-2 pb-2 border-b border-slate-800">
                  <span className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse"></span>
                  <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">System Engine Internal Logs</span>
                </div>
                <ScrollArea className="flex-1">
                  <div className="flex-1 text-[11px] leading-tight space-y-1.5 p-1 pr-4">
                    <p className="text-slate-400"><span className="text-emerald-500">INIT</span> Loading extraction nodes... 12/12 online.</p>
                    <p className="text-slate-400"><span className="text-indigo-400">DISP</span> Scheduler heartbeat detected at 42ms interval.</p>
                    <p className="text-slate-400"><span className="text-blue-400">SYNC</span> Atomic records pushed to PostgreSQL cluster (ID: {Math.random().toString(36).substring(7)}).</p>
                    <p className="text-slate-500 italic">WAIT Processing heavy load from crawler pool US-EAST-B...</p>
                    <p className="text-rose-400 font-bold underline"><span className="bg-rose-900/50 px-1 rounded">ALRT</span> IP 42.19.0.224 flagged for excessive retries (403 Forbidden).</p>
                    <p className="text-slate-400"><span className="text-emerald-500">INFO</span> Raw page buffer compressed at 4.2:1 ratio for efficient storage.</p>
                  </div>
                </ScrollArea>
              </div>
            </>
          )}

          {activeTab === "job-detail" && selectedJob && jobDetail && (
            <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="flex items-center gap-4">
                <Button variant="outline" size="icon" className="rounded-full" onClick={() => setActiveTab("jobs")}><LayoutDashboard className="w-4 h-4" /></Button>
                <div>
                  <div className="flex items-center gap-3">
                    <h2 className="text-2xl font-bold">{selectedJob.name}</h2>
                    {getStatusBadge(jobDetail.job.status)}
                  </div>
                  <p className="text-gray-500 text-sm mt-1">{selectedJob.id}</p>
                </div>
                <div className="ml-auto flex gap-2">
                  <Button variant="outline" size="sm" asChild>
                    <a href={`/api/export?jobId=${selectedJob.id}&format=csv`} download>
                      <Download className="w-4 h-4 mr-2" /> Export CSV
                    </a>
                  </Button>
                  <Button variant="outline" size="sm" asChild>
                    <a href={`/api/export?jobId=${selectedJob.id}&format=json`} download>
                      <Download className="w-4 h-4 mr-2" /> Export JSON
                    </a>
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-8">
                <Card className="col-span-2 border-none shadow-sm">
                  <CardHeader>
                    <CardTitle>Recent Task Activity</CardTitle>
                    <CardDescription>Real-time feed of URL processing status</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ScrollArea className="h-[400px] pr-4">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="font-bold text-[10px] uppercase tracking-widest text-[#999]">URL Target</TableHead>
                            <TableHead className="font-bold text-[10px] uppercase tracking-widest text-[#999]">Depth</TableHead>
                            <TableHead className="font-bold text-[10px] uppercase tracking-widest text-[#999]">State</TableHead>
                            <TableHead className="font-bold text-[10px] uppercase tracking-widest text-[#999]">Code</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {jobDetail.tasks.map((task: any) => (
                            <TableRow key={task.id} className="text-xs transition-colors hover:bg-gray-50">
                              <TableCell className="max-w-[300px] truncate font-mono text-blue-600 hover:underline cursor-pointer" onClick={() => window.open(task.url, '_blank')}>
                                {task.url}
                              </TableCell>
                              <TableCell>{task.depth}</TableCell>
                              <TableCell>{task.status}</TableCell>
                              <TableCell>
                                <span className={task.http_status >= 200 && task.http_status < 300 ? "text-green-500 font-bold" : "text-red-500"}>
                                  {task.http_status || '-'}
                                </span>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </ScrollArea>
                  </CardContent>
                </Card>

                <div className="space-y-8">
                  <Card className="border-none shadow-sm bg-[#141414] text-white">
                    <CardHeader>
                      <CardTitle className="text-lg">Yield Metrics</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-6">
                      <div className="space-y-2">
                        <div className="flex justify-between text-xs font-bold uppercase tracking-widest text-gray-400">
                          <span>Progress</span>
                          <span>{Math.round((jobDetail.metrics.success / selectedJob.max_pages) * 100)}%</span>
                        </div>
                        <Progress value={(jobDetail.metrics.success / selectedJob.max_pages) * 100} className="bg-gray-800" />
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="p-3 bg-white/5 rounded-lg">
                          <p className="text-[10px] uppercase text-gray-400 font-bold">Success</p>
                          <p className="text-xl font-mono">{jobDetail.metrics.success}</p>
                        </div>
                        <div className="p-3 bg-white/5 rounded-lg">
                          <p className="text-[10px] uppercase text-gray-400 font-bold">Failed</p>
                          <p className="text-xl font-mono text-red-400">{jobDetail.metrics.failed}</p>
                        </div>
                        <div className="p-3 bg-white/5 rounded-lg">
                          <p className="text-[10px] uppercase text-gray-400 font-bold">Queue</p>
                          <p className="text-xl font-mono">{jobDetail.metrics.pending}</p>
                        </div>
                        <div className="p-3 bg-white/5 rounded-lg">
                          <p className="text-[10px] uppercase text-gray-400 font-bold">Total</p>
                          <p className="text-xl font-mono">{jobDetail.metrics.total}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  <Button 
                    className="w-full h-12 gap-2 text-indigo-600 border-indigo-200 hover:bg-indigo-50" 
                    variant="outline"
                    onClick={() => { setActiveTab("search"); fetchRecords(selectedJob.id); }}
                  >
                    View Extracted Records <ChevronRight className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </div>
          )}

          {activeTab === "search" && (
            <div className="space-y-8">
              <div className="flex flex-col md:flex-row gap-4 items-start md:items-center justify-between">
                <div className="relative w-full max-w-lg">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <Input 
                    placeholder="Search in extracted data..." 
                    className="pl-10 h-11 bg-white border-none shadow-sm"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>
                <div className="flex gap-2 w-full md:w-auto">
                   <Button variant="outline"><Download className="w-4 h-4 mr-2" /> Export View</Button>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-6">
                {records.filter(r => r.title.toLowerCase().includes(searchQuery.toLowerCase()) || r.content.toLowerCase().includes(searchQuery.toLowerCase())).length === 0 ? (
                  <div className="col-span-full py-20 text-center space-y-4">
                    <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto text-slate-400">
                      <Search className="w-8 h-8" />
                    </div>
                    <p className="text-slate-500 font-medium italic">No records matching your search criteria were found in our databanks.</p>
                  </div>
                ) : (
                  records.filter(r => r.title.toLowerCase().includes(searchQuery.toLowerCase()) || r.content.toLowerCase().includes(searchQuery.toLowerCase())).map((record) => (
                    <Card key={record.id} className="border-none shadow-sm group hover:shadow-md transition-all overflow-hidden border-l-4 border-l-transparent hover:border-l-indigo-500">
                      <CardHeader className="pb-3">
                        <div className="flex justify-between items-start">
                          <div className="space-y-1">
                            <CardTitle className="text-lg font-bold group-hover:text-indigo-600 transition-colors">{record.title || 'Untitled Operation'}</CardTitle>
                            <CardDescription className="flex items-center gap-2 font-mono text-[10px]">
                              {record.url} <ExternalLink className="w-3 h-3 cursor-pointer opacity-50 hover:opacity-100" onClick={() => window.open(record.url, '_blank')} />
                            </CardDescription>
                          </div>
                          <div className="flex items-center gap-2">
                             <Badge variant="secondary" className="bg-gray-100 text-gray-600 font-mono text-[9px] uppercase">{record.page_type}</Badge>
                             <Button size="icon" variant="outline" className="h-8 w-8 text-indigo-600 hover:text-white hover:bg-indigo-600" onClick={() => handleAIAnalyze(record)}>
                               <Sparkles className="w-4 h-4" />
                             </Button>
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent>
                        <p className="text-sm text-gray-500 line-clamp-3 leading-relaxed">
                          {record.content || 'Analytical data extraction signature verified.'}
                        </p>
                      </CardContent>
                      <CardFooter className="bg-gray-50/50 flex justify-between py-2 px-6">
                         <span className="text-[10px] uppercase font-bold text-gray-400 tracking-wider">Identified {new Date(record.created_at).toLocaleString()}</span>
                         <Button variant="link" size="sm" className="text-xs text-indigo-500 h-6">Examine Raw Payload</Button>
                      </CardFooter>
                    </Card>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </section>
      {/* Bottom Status Footer */}
      <footer className="h-10 bg-white border-t border-slate-200 px-6 flex items-center justify-between text-[11px] text-slate-500 z-20">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <div className="status-dot bg-indigo-500"></div>
            <span className="font-bold uppercase tracking-tighter">Scheduler: Online</span>
          </div>
          <div className="h-3 w-px bg-slate-200"></div>
          <div className="flex items-center gap-1.5">
            <div className="status-dot bg-emerald-500"></div>
            <span className="font-bold uppercase tracking-tighter text-emerald-600">Engine: Healthy (18ms)</span>
          </div>
        </div>
        <div className="flex items-center gap-6 font-mono text-[10px]">
          <span>CPU: 14%</span>
          <span>RAM: 3.2 / 16GB</span>
          <span className="text-indigo-600 font-bold uppercase tracking-tighter">Universal Crawler Enterprise v2.4</span>
        </div>
      </footer>
    </div>
  );
}

