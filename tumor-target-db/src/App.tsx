import { useState, useEffect, useMemo, useRef } from 'react';
import * as echarts from 'echarts';
import { jsPDF } from 'jspdf';
import ReactMarkdown from 'react-markdown';
import {
  Database,
  ChevronUp,
  ChevronDown,
  FileText,
  Download,
  X,
  Loader2,
  Dna,
  BarChart3,
  TrendingUp,
  Activity,
  Search,
  ChevronLeft,
  ChevronRight,
  Layers
} from 'lucide-react';

// Types
interface GeneSelectivity {
  gene_name: string;
  S_active_log2FC_max: number;
  E_inactive_expression_max: number;
  active_count: number;
  max_tumor_expression: number;
  active_projects: string;
  Selection_Score: number;
  active_project: string;
}

interface TumorNormalData {
  Gene: string;
  'Gene name': string;
  [key: string]: string | number;
}

interface CptacData {
  Cancer: string;
  Gene: string;
  'Gene name': string;
  'p-value adjusted': string;
  logFC: string;
}

const ALL_CANCERS = 'All Cancers';

const CANCER_TYPES = [
  'breast cancer', 'carcinoid', 'cervical cancer', 'colorectal cancer',
  'endometrial cancer', 'glioma', 'head and neck cancer', 'liver cancer',
  'lung cancer', 'lymphoma', 'melanoma', 'ovarian cancer', 'pancreatic cancer',
  'prostate cancer', 'renal cancer', 'skin cancer', 'stomach cancer',
  'testis cancer', 'thyroid cancer', 'urothelial cancer'
];

const CANCER_LABELS = CANCER_TYPES.map(c => c.replace(' cancer', '').replace('head and neck', 'H&N'));

const SUPABASE_URL = 'https://sawpjhozfkswryhlporu.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNhd3BqaG96Zmtzd3J5aGxwb3J1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc2NzY4MjEsImV4cCI6MjA4MzI1MjgyMX0.ElO6b_hW87OKPevAAzYwU0XCKvMK80CFgz0a_2LJQJM';

const PAGE_SIZE = 50;

function parseTSV(text: string): Record<string, string>[] {
  const lines = text.trim().split('\n');
  const headers = lines[0].split('\t');
  return lines.slice(1).map(line => {
    const values = line.split('\t');
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => { obj[h] = values[i] || ''; });
    return obj;
  });
}

// ECharts component
function EChart({ option, height = 350 }: { option: echarts.EChartsOption; height?: number }) {
  const chartRef = useRef<HTMLDivElement>(null);
  const chartInstance = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (chartRef.current) {
      chartInstance.current = echarts.init(chartRef.current);
      chartInstance.current.setOption(option);
    }
    return () => { chartInstance.current?.dispose(); };
  }, []);

  useEffect(() => {
    chartInstance.current?.setOption(option, true);
  }, [option]);

  useEffect(() => {
    const handleResize = () => chartInstance.current?.resize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return <div ref={chartRef} style={{ width: '100%', height }} />;
}

export default function App() {
  const [selectivityData, setSelectivityData] = useState<GeneSelectivity[]>([]);
  const [tumorNormalData, setTumorNormalData] = useState<TumorNormalData[]>([]);
  const [cptacData, setCptacData] = useState<CptacData[]>([]);
  const [selectedCancer, setSelectedCancer] = useState(ALL_CANCERS);
  const [selectedGene, setSelectedGene] = useState<string | null>(null);
  const [sortConfig, setSortConfig] = useState<{key: string; dir: 'asc'|'desc'}>({key: 'Selection_Score', dir: 'desc'});
  const [loading, setLoading] = useState(true);
  const [reportModal, setReportModal] = useState(false);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportContent, setReportContent] = useState('');
  const [reportGene, setReportGene] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchError, setSearchError] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const tableRef = useRef<HTMLTableElement>(null);

  useEffect(() => {
    Promise.all([
      fetch('/data/gene_selectivity_scores_score_based__one_project_per_row.csv').then(r => r.text()),
      fetch('/data/tumor_normal_scores_wide_deNA.tsv').then(r => r.text()),
      fetch('/data/cptac.tsv').then(r => r.text())
    ]).then(([sel, tn, cp]) => {
      setSelectivityData(parseTSV(sel) as unknown as GeneSelectivity[]);
      setTumorNormalData(parseTSV(tn) as unknown as TumorNormalData[]);
      setCptacData(parseTSV(cp) as unknown as CptacData[]);
      setLoading(false);
    });
  }, []);

  const filteredSelectivity = useMemo(() => {
    if (selectedCancer === ALL_CANCERS) {
      // For "All Cancers", group by gene_name and take the one with max Selection_Score
      const geneMap = new Map<string, GeneSelectivity>();
      selectivityData.forEach(d => {
        const existing = geneMap.get(d.gene_name);
        if (!existing || Number(d.Selection_Score) > Number(existing.Selection_Score)) {
          geneMap.set(d.gene_name, d);
        }
      });
      return Array.from(geneMap.values());
    }
    return selectivityData.filter(d => d.active_project === selectedCancer);
  }, [selectivityData, selectedCancer]);

  const filteredCptac = useMemo(() => {
    if (selectedCancer === ALL_CANCERS) {
      return cptacData; // All data for volcano plot
    }
    return cptacData.filter(d => d.Cancer === selectedCancer);
  }, [cptacData, selectedCancer]);

  const sortedData = useMemo(() => {
    const data = [...filteredSelectivity];
    data.sort((a, b) => {
      const aVal = Number(a[sortConfig.key as keyof GeneSelectivity]) || 0;
      const bVal = Number(b[sortConfig.key as keyof GeneSelectivity]) || 0;
      return sortConfig.dir === 'desc' ? bVal - aVal : aVal - bVal;
    });
    return data;
  }, [filteredSelectivity, sortConfig]);

  const totalPages = Math.ceil(sortedData.length / PAGE_SIZE);
  const paginatedData = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return sortedData.slice(start, start + PAGE_SIZE);
  }, [sortedData, currentPage]);

  // Auto-select top gene when cancer changes or data loads
  useEffect(() => {
    if (sortedData.length > 0 && !selectedGene) {
      setSelectedGene(sortedData[0].gene_name);
    }
  }, [sortedData, selectedGene]);

  // Reset selectedGene and page when cancer changes
  const handleCancerChange = (cancer: string) => {
    setSelectedCancer(cancer);
    setSelectedGene(null);
    setCurrentPage(1);
    setSearchQuery('');
    setSearchError('');
  };

  const handleSearch = () => {
    if (!searchQuery.trim()) return;
    const query = searchQuery.trim().toUpperCase();
    const index = sortedData.findIndex(d => d.gene_name.toUpperCase() === query);
    if (index === -1) {
      setSearchError('未检索到该基因');
      return;
    }
    setSearchError('');
    const page = Math.floor(index / PAGE_SIZE) + 1;
    setCurrentPage(page);
    setSelectedGene(sortedData[index].gene_name);
  };

  const stats = useMemo(() => {
    if (filteredSelectivity.length === 0) return null;
    const maxScore = Math.max(...filteredSelectivity.map(d => Number(d.Selection_Score) || 0));
    const maxTumor = Math.max(...filteredSelectivity.map(d => Number(d.max_tumor_expression) || 0));
    const maxLogFC = Math.max(...filteredSelectivity.map(d => Number(d.S_active_log2FC_max) || 0));
    const topGeneScore = filteredSelectivity.find(d => Number(d.Selection_Score) === maxScore);
    const topGeneTumor = filteredSelectivity.find(d => Number(d.max_tumor_expression) === maxTumor);
    const topGeneLogFC = filteredSelectivity.find(d => Number(d.S_active_log2FC_max) === maxLogFC);
    return { geneCount: filteredSelectivity.length, maxScore, maxTumor, maxLogFC,
      topGeneScore: topGeneScore?.gene_name || '', topGeneTumor: topGeneTumor?.gene_name || '', topGeneLogFC: topGeneLogFC?.gene_name || '' };
  }, [filteredSelectivity]);

  const volcanoOption = useMemo((): echarts.EChartsOption | null => {
    if (filteredCptac.length === 0) return null;
    const data = filteredCptac.map(d => {
      const pval = parseFloat(d['p-value adjusted']) || 1;
      const logFC = parseFloat(d.logFC) || 0;
      const negLogP = pval > 0 ? -Math.log10(pval) : 0;
      let color = '#ADB5BD';
      if (pval < 0.05 && logFC > 1) color = '#E03131';
      else if (pval < 0.05 && logFC < -1) color = '#1098AD';
      return { value: [logFC, negLogP], name: d['Gene name'], itemStyle: { color } };
    });
    return {
      tooltip: { trigger: 'item', formatter: (p: unknown) => {
        const params = p as { data: { name: string; value: number[] } };
        return `<b>${params.data.name}</b><br/>logFC: ${params.data.value[0].toFixed(3)}<br/>-log10(p): ${params.data.value[1].toFixed(3)}`;
      }},
      grid: { left: 60, right: 30, top: 20, bottom: 50 },
      xAxis: { name: 'log2FC', nameLocation: 'center', nameGap: 30, splitLine: { lineStyle: { type: 'dashed', color: '#F1F3F5' }}},
      yAxis: { name: '-log10(p-value)', nameLocation: 'center', nameGap: 40, splitLine: { lineStyle: { type: 'dashed', color: '#F1F3F5' }}},
      series: [{ type: 'scatter', symbolSize: 6, data }]
    };
  }, [filteredCptac]);

  // Grouped bar chart for all 20 cancer types
  const barOption = useMemo((): echarts.EChartsOption | null => {
    if (!selectedGene) return null;
    const geneData = tumorNormalData.find(d => d['Gene name'] === selectedGene);
    if (!geneData) return null;
    
    const tumorData: number[] = [];
    const normalData: number[] = [];
    
    CANCER_TYPES.forEach(cancer => {
      const tumorVal = parseFloat(String(geneData[`tumor_score_${cancer}`])) || 0;
      const normalVal = parseFloat(String(geneData[`normal_score_${cancer}`])) || 0;
      tumorData.push(tumorVal);
      normalData.push(normalVal);
    });

    return {
      tooltip: { 
        trigger: 'axis',
        axisPointer: { type: 'shadow' }
      },
      legend: {
        data: ['Tumor', 'Normal'],
        top: 0,
        right: 20
      },
      grid: { left: 50, right: 20, top: 40, bottom: 80 },
      xAxis: { 
        type: 'category', 
        data: CANCER_LABELS,
        axisLabel: { rotate: 45, fontSize: 10 }
      },
      yAxis: { 
        type: 'value', 
        name: 'Expression Score',
        min: 0,
        max: 3
      },
      series: [
        { 
          name: 'Tumor',
          type: 'bar', 
          data: tumorData,
          itemStyle: { color: '#E03131' },
          barGap: '10%'
        },
        { 
          name: 'Normal',
          type: 'bar', 
          data: normalData,
          itemStyle: { color: '#1098AD' }
        }
      ]
    };
  }, [selectedGene, tumorNormalData]);

  const generateReport = async (geneName: string) => {
    setReportGene(geneName);
    setReportLoading(true);
    setReportModal(true);
    setReportContent('');
    const geneData = filteredSelectivity.find(d => d.gene_name === geneName);
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/generate-report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` },
        body: JSON.stringify({ geneName, cancerType: selectedCancer === ALL_CANCERS ? 'all cancer types' : selectedCancer, geneData })
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error.message);
      setReportContent(data.data?.report || 'No report generated');
    } catch (e) {
      setReportContent(`Error: ${e instanceof Error ? e.message : 'Failed to generate report'}`);
    }
    setReportLoading(false);
  };

  const downloadPDF = () => {
    const doc = new jsPDF();
    doc.setFontSize(16);
    doc.text(`Gene Report: ${reportGene}`, 20, 20);
    doc.setFontSize(10);
    // Strip markdown formatting for PDF
    const plainText = reportContent
      .replace(/#{1,6}\s/g, '')
      .replace(/\*\*(.*?)\*\*/g, '$1')
      .replace(/\*(.*?)\*/g, '$1')
      .replace(/`(.*?)`/g, '$1')
      .replace(/\[(.*?)\]\(.*?\)/g, '$1');
    const lines = doc.splitTextToSize(plainText, 170);
    doc.text(lines, 20, 35);
    doc.save(`${reportGene}_report.pdf`);
  };

  const exportCSV = () => {
    const headers = ['gene_name', 'Selection_Score', 'max_tumor_expression', 'S_active_log2FC_max', 'active_projects', 'E_inactive_expression_max'];
    const csvContent = [
      headers.join(','),
      ...sortedData.map(row => headers.map(h => {
        const val = row[h as keyof GeneSelectivity];
        return typeof val === 'string' && val.includes(',') ? `"${val}"` : val;
      }).join(','))
    ].join('\n');
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `gene_selectivity_${selectedCancer === ALL_CANCERS ? 'all' : selectedCancer.replace(/\s/g, '_')}.csv`;
    link.click();
  };

  const handleSort = (key: string) => {
    setSortConfig(prev => ({ key, dir: prev.key === key && prev.dir === 'desc' ? 'asc' : 'desc' }));
    setCurrentPage(1);
  };

  if (loading) {
    return <div className="h-screen flex items-center justify-center bg-neutral-50"><Loader2 className="w-8 h-8 animate-spin text-primary-500" /></div>;
  }

  return (
    <div className="flex h-screen bg-neutral-50">
      {/* Sidebar */}
      <aside className="w-60 bg-white border-r border-neutral-100 flex flex-col">
        <div className="p-5 border-b border-neutral-100">
          <div className="flex items-center gap-2">
            <Database className="w-6 h-6 text-primary-500" />
            <h1 className="text-lg font-semibold text-neutral-900">TST Database</h1>
          </div>
          <p className="text-xs text-neutral-500 mt-1">Tumor Selective Targets</p>
        </div>
        <nav className="flex-1 overflow-y-auto p-3">
          <p className="text-xs font-medium text-neutral-500 uppercase mb-2 px-2">Cancer Types</p>
          {/* All Cancers option */}
          <button onClick={() => handleCancerChange(ALL_CANCERS)}
            className={`w-full text-left px-3 py-2 rounded-md text-sm flex items-center gap-2 transition-all ${
              selectedCancer === ALL_CANCERS ? 'bg-primary-50 text-primary-600 border-l-[3px] border-primary-500' : 'text-neutral-700 hover:bg-neutral-50'
            }`}>
            <Layers className="w-4 h-4" />
            {ALL_CANCERS}
          </button>
          <div className="border-b border-neutral-100 my-2" />
          {CANCER_TYPES.map(cancer => (
            <button key={cancer} onClick={() => handleCancerChange(cancer)}
              className={`w-full text-left px-3 py-2 rounded-md text-sm capitalize transition-all ${
                selectedCancer === cancer ? 'bg-primary-50 text-primary-600 border-l-[3px] border-primary-500' : 'text-neutral-700 hover:bg-neutral-50'
              }`}>{cancer}</button>
          ))}
        </nav>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-auto p-6">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h2 className="text-2xl font-semibold text-neutral-900 capitalize">{selectedCancer}</h2>
            <p className="text-sm text-neutral-500">Gene selectivity analysis dashboard</p>
          </div>
          <button onClick={exportCSV} className="flex items-center gap-2 px-4 py-2 bg-primary-500 text-white rounded-md hover:bg-primary-600 transition-colors">
            <Download className="w-4 h-4" />Export Data
          </button>
        </div>

        {/* Stats Cards */}
        {stats && (
          <div className="grid grid-cols-4 gap-4 mb-6">
            <div className="bg-white rounded-md shadow-sm p-5">
              <div className="flex items-center gap-2 text-neutral-500 text-xs uppercase mb-2"><Dna className="w-4 h-4" />Total Genes</div>
              <div className="text-3xl font-semibold text-neutral-900 tabular-nums">{stats.geneCount}</div>
            </div>
            <div className="bg-white rounded-md shadow-sm p-5 group relative">
              <div className="flex items-center gap-2 text-neutral-500 text-xs uppercase mb-2"><TrendingUp className="w-4 h-4" />Max Selection Score</div>
              <div className="text-3xl font-semibold text-neutral-900 tabular-nums">{stats.maxScore.toFixed(2)}</div>
              <div className="absolute inset-0 bg-neutral-900/90 rounded-md text-white p-4 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                <span className="font-mono text-sm">{stats.topGeneScore}</span>
              </div>
            </div>
            <div className="bg-white rounded-md shadow-sm p-5 group relative">
              <div className="flex items-center gap-2 text-neutral-500 text-xs uppercase mb-2"><Activity className="w-4 h-4" />Max Tumor Expression</div>
              <div className="text-3xl font-semibold text-neutral-900 tabular-nums">{stats.maxTumor.toFixed(2)}</div>
              <div className="absolute inset-0 bg-neutral-900/90 rounded-md text-white p-4 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                <span className="font-mono text-sm">{stats.topGeneTumor}</span>
              </div>
            </div>
            <div className="bg-white rounded-md shadow-sm p-5 group relative">
              <div className="flex items-center gap-2 text-neutral-500 text-xs uppercase mb-2"><BarChart3 className="w-4 h-4" />Max log2FC</div>
              <div className="text-3xl font-semibold text-neutral-900 tabular-nums">{stats.maxLogFC.toFixed(2)}</div>
              <div className="absolute inset-0 bg-neutral-900/90 rounded-md text-white p-4 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                <span className="font-mono text-sm">{stats.topGeneLogFC}</span>
              </div>
            </div>
          </div>
        )}

        {/* Volcano Plot - Full Width */}
        {volcanoOption && (
          <div className="bg-white rounded-md shadow-sm p-5 mb-6">
            <h3 className="text-lg font-semibold text-neutral-900 mb-4">Volcano plot based on CPTAC dataset</h3>
            <EChart option={volcanoOption} height={300} />
          </div>
        )}

        {/* Grouped Bar Chart - Full Width */}
        <div className="bg-white rounded-md shadow-sm p-5 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-neutral-900">
              Protein Expression data Distribution based on IHC dataset
              {selectedGene && <span className="text-primary-500 ml-2">({selectedGene})</span>}
            </h3>
          </div>
          {barOption ? <EChart option={barOption} height={280} /> : (
            <div className="h-[280px] flex items-center justify-center text-neutral-400 text-sm">Loading...</div>
          )}
        </div>

        {/* Data Table */}
        <div className="bg-white rounded-md shadow-sm overflow-hidden">
          <div className="p-4 border-b border-neutral-100 flex justify-between items-center">
            <h3 className="text-lg font-semibold text-neutral-900">Gene Selectivity Data</h3>
            <div className="flex items-center gap-2">
              <div className="relative">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => { setSearchQuery(e.target.value); setSearchError(''); }}
                  onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                  placeholder="Search gene..."
                  className="pl-9 pr-3 py-1.5 border border-neutral-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent w-48"
                />
                <Search className="w-4 h-4 text-neutral-400 absolute left-3 top-1/2 -translate-y-1/2" />
              </div>
              <button onClick={handleSearch} className="px-3 py-1.5 bg-primary-500 text-white text-sm rounded-md hover:bg-primary-600">
                Search
              </button>
            </div>
          </div>
          {searchError && (
            <div className="px-4 py-2 bg-red-50 text-red-600 text-sm">{searchError}</div>
          )}
          <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
            <table ref={tableRef} className="w-full text-sm">
              <thead className="bg-neutral-50 sticky top-0">
                <tr>
                  {['gene_name', 'Selection_Score', 'max_tumor_expression', 'S_active_log2FC_max', 'active_projects', 'E_inactive_expression_max'].map(col => (
                    <th key={col} onClick={() => handleSort(col)} className="px-4 py-3 text-left text-neutral-600 font-medium cursor-pointer hover:bg-neutral-100 select-none">
                      <div className="flex items-center gap-1">
                        {col === 'gene_name' ? 'Gene' : col.replace(/_/g, ' ')}
                        {sortConfig.key === col && (sortConfig.dir === 'desc' ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />)}
                      </div>
                    </th>
                  ))}
                  <th className="px-4 py-3 text-left text-neutral-600 font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {paginatedData.map((row, i) => (
                  <tr key={i} onClick={() => setSelectedGene(row.gene_name)} className={`border-b border-neutral-100 cursor-pointer transition-colors ${selectedGene === row.gene_name ? 'bg-primary-50' : 'hover:bg-neutral-50'}`}>
                    <td className="px-4 py-3 font-mono font-medium text-primary-600">{row.gene_name}</td>
                    <td className="px-4 py-3 tabular-nums">{Number(row.Selection_Score).toFixed(4)}</td>
                    <td className="px-4 py-3 tabular-nums">{Number(row.max_tumor_expression).toFixed(4)}</td>
                    <td className="px-4 py-3 tabular-nums">{Number(row.S_active_log2FC_max).toFixed(4)}</td>
                    <td className="px-4 py-3 text-xs max-w-[200px] truncate" title={String(row.active_projects)}>{row.active_projects}</td>
                    <td className="px-4 py-3 tabular-nums">{Number(row.E_inactive_expression_max).toFixed(4)}</td>
                    <td className="px-4 py-3">
                      <button onClick={(e) => { e.stopPropagation(); generateReport(row.gene_name); }} className="text-primary-500 hover:text-primary-600 text-xs font-medium">Report</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Pagination */}
          <div className="px-4 py-3 border-t border-neutral-100 flex items-center justify-between">
            <div className="text-sm text-neutral-500">
              Showing {((currentPage - 1) * PAGE_SIZE) + 1} - {Math.min(currentPage * PAGE_SIZE, sortedData.length)} of {sortedData.length} genes
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="p-1.5 rounded border border-neutral-200 hover:bg-neutral-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-sm text-neutral-600">
                Page {currentPage} of {totalPages}
              </span>
              <button
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="p-1.5 rounded border border-neutral-200 hover:bg-neutral-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </main>

      {/* Report Modal */}
      {reportModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-8">
          <div className="bg-white rounded-lg shadow-lg w-full max-w-3xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-neutral-100">
              <h3 className="text-lg font-semibold text-neutral-900">Gene Report: {reportGene}</h3>
              <div className="flex items-center gap-2">
                {!reportLoading && reportContent && (
                  <button onClick={downloadPDF} className="flex items-center gap-1 px-3 py-1.5 text-sm bg-primary-500 text-white rounded hover:bg-primary-600">
                    <Download className="w-4 h-4" /> PDF
                  </button>
                )}
                <button onClick={() => setReportModal(false)} className="p-1 hover:bg-neutral-100 rounded"><X className="w-5 h-5 text-neutral-500" /></button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              {reportLoading ? (
                <div className="flex flex-col items-center justify-center py-12">
                  <Loader2 className="w-8 h-8 animate-spin text-primary-500 mb-4" />
                  <p className="text-neutral-500">Generating report with AI...</p>
                  <p className="text-xs text-neutral-400 mt-1">This may take a moment</p>
                </div>
              ) : (
                <div className="prose prose-sm max-w-none text-neutral-800">
                  <ReactMarkdown>{reportContent}</ReactMarkdown>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
