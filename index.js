import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { UploadCloud, Zap, Copy, FileText, Loader, AlertTriangle, FileUp, Factory, Hammer, Download } from 'lucide-react';

// 라이브러리 로드
const PapaParseScript = document.createElement('script');
PapaParseScript.src = 'https://cdnjs.cloudflare.com/ajax/libs/PapaParse/5.3.0/papaparse.min.js';
document.head.appendChild(PapaParseScript);

const SheetJSScript = document.createElement('script');
SheetJSScript.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
document.head.appendChild(SheetJSScript);

// 데모 데이터 (단조공장 RAW DATA 형식)
const DEMO_RAW_CSV = `
단조작업일,납기일자,작업장,프레스별,공정,작업조,수주번호,실적,양품,불량,생산단중,생산중량(양품),품명,제품형상,치수,도면,재질,강종,소재품명,소재타입,INGOT 종류
2025-01-02,2025-03-24,"OS,TW,P15",P15,단조제품,야간조,240627-15111-004,1,1,0,25625,25625,PROPELLER SHAFT,SHAFT,"926.00*0.00*9,140.00",,FORGED STEEL,CARBON,태웅-I-34850-16 (CARBON),INGOT,IC
2025-01-02,2025-01-29,"TW,P15",P15,단조제품,야간조,241129-12005-001,1,1,0,42565,42565,RUDDER TRUNK,RING,"1,565.00*970.00*5,325.00",,FORGED STEEL,CARBON,태웅-I-53100-10(CARBON),INGOT,IC
2025-01-03,2025-02-14,"H1,OS,P8,R9,TW",P8,황지,주간조,241108-15207-001,1,1,1,4084,4084,내셔날오일웰바르코코리아유한회사,조선,황삭,FORGING,RING,"2,286.00*2,041.00*494.00",19106582-DAD R.01,S355J2G3,CARBON,태웅-B-800 (CARBON),R/B,
2025-01-04,2025-04-03,"OS,P5,R9,TW,P15",R9,단조제품,야간조,240924-19661-031,2,2,2,0,10515,28903716,HAIZEA WIND,풍력,정삭,5258,TOWER FLANGE,RING,"3,600.00*3,250.00*195.00",703712280 Rev.-,AISI4140,ALLOY,태웅-B-500 (ALLOY),R/B,
2025-02-05,2025-04-10,"OS,TW,P15",P15,단조제품,야간조,241016-15111-003,1,1,0,39869,39869,INTER' SHAFT #1,SHAFT,"1,406.00*0.00*5,518.00",,FORGED STEEL,CARBON,태웅-I-40100-16 (CARBON),INGOT,VSD
2025-01-14,2025-02-05,"TW,P15",P15,단조제품,야간조,241219-12005-006,1,1,0,21984,21984,RUDDER TRUNK,RING,"1,185.00*726.00*4,230.00",,FORGED STEEL,CARBON,태웅-I-25600-8(CARBON),INGOT,IC
2025-01-02,2025-01-20,"OS,P5,R9,TW",P5,단조제품,주간조,241008-19004-002,1,2,2,0,7360,14720,M.H.I,산업기계,정삭,3680,END RING,RING,"2,400.00*1,680.00*355.00",J01-50346 Rev.0 #2,A266Gr1,CARBON,NSC-S-300(CARBON),SLAB,
2025-02-01,2025-05-09,"H1,OS,R9,TW",R9,황지,주간조,241028-17029-002,1,1,1,1000,1000,현대삼호 주식회사,산업기계,정삭,WHEEL,DISC,"800.00*180.00*185.00",T1-CN-1E101,SSW Q3R,SUS,태웅-B-600 (SUS),R/B,
`;

// CBAM 보고서에 고정되어야 하는 제품 구조 (재고가 없더라도 행은 존재해야 함)
const CBAM_REPORT_STRUCTURE = [
    { shape: 'INGOT', casting: 'IC', '탄소강': 0, '합금강': 0, '스텐레스강': 0 },
    { shape: 'INGOT', casting: 'VSD', '탄소강': 0, '합금강': 0, '스텐레스강': 0 },
    { shape: 'R/BLOOM', casting: 'N/A', '탄소강': 0, '합금강': 0, '스텐레스강': 0 },
    { shape: 'SLAB', casting: 'N/A', '탄소강': 0, '합금강': 0, '스텐레스강': 0 },
];

const App = () => {
    const [csvInput, setCsvInput] = useState(DEMO_RAW_CSV.trim());
    const [processedData, setProcessedData] = useState(null);
    const [isProcessing, setIsProcessing] = useState(false);
    const [error, setError] = useState(null);
    const [copied, setCopied] = useState(false);
    const [inputMethod, setInputMethod] = useState('text');
    const [reportMode, setReportMode] = useState('forging');
    
    // 6개 필수 컬럼 목록
    const REQUIRED_COLUMNS = [
        '생산중량(양품)',
        '프레스별', // 설비 분류
        '제품형상', // 제품 분류
        '강종', // 재질 분류
        '소재타입', // 소재 분류
        'INGOT 종류' // 주조 분류
    ];
    
    // --- 유틸리티 함수: 공백 및 '합계 :' 접두사를 제거하고 정확한 컬럼 값을 가져옴 ---
    const getKeyValue = (item, targetKey) => {
        if (!item) return null;
        const targetKeyCleaned = targetKey.trim();
        
        // 1. item의 모든 키를 순회하며 targetKey와 일치하는지 확인
        const foundKey = Object.keys(item).find(k => {
            const trimmedKey = k ? k.trim() : '';
            // 1-1. 정확히 일치하는 경우
            if (trimmedKey === targetKeyCleaned) return true;
            // 1-2. 피벗 테이블 헤더 접두사 ("합계 : ")가 붙은 경우에도 일치하는지 확인
            if (trimmedKey.startsWith('합계 : ') && trimmedKey.includes(targetKeyCleaned)) return true;
            // 1-3. "열 레이블" 등 불필요한 키는 무시
            return false;
        });
        
        // 2. 키가 존재하면 해당 값을 반환
        return foundKey ? item[foundKey] : null;
    };

    // 단조공장 데이터 집계 로직
    const aggregateForgingData = useCallback((data, actualHeaders) => {
        // 설비 및 형상 목록 정의
        const machines = ['P15', 'P5', 'P8', 'RM', 'R9'];
        const shapes = ['RING', 'SHAFT', 'DISC', 'SHELL', 'SQUARE', '황지'];

        // 데이터 구조 초기화
        const matrix = {};
        machines.forEach(machine => {
            matrix[machine] = {};
            shapes.forEach(shape => {
                matrix[machine][shape] = {
                    carbon_ingot_ic: 0, carbon_ingot_vsd: 0, carbon_ingot_cc: 0, carbon_rb: 0, carbon_slab: 0,
                    alloy_ingot_ic: 0, alloy_ingot_vsd: 0, alloy_ingot_cc: 0, alloy_rb: 0, alloy_slab: 0,
                    sus_ingot_ic: 0, sus_ingot_cc: 0, sus_rb: 0, sus_slab: 0,
                    tool_ingot_ic: 0, tool_slab: 0,
                };
            });
        });

        // 기타/미분류 설비용
        matrix['Other'] = {};
        
        // 피벗 테이블 요약 행/열을 걸러내기 위한 키워드 (소문자로 처리)
        const pivotKeywords = ['총합계', '합계', '소계', '레이블', 'grand total', 'subtotal'];

        // --- 필수 컬럼 존재 여부 및 유효성 검사 ---
        const missingColumns = REQUIRED_COLUMNS.filter(col => !actualHeaders.includes(col));
        if (missingColumns.length > 0) {
            throw new Error(`필수 컬럼 누락: 다음 컬럼들이 RAW DATA 헤더에 없습니다: [${missingColumns.join(', ')}]`);
        }
        // ---------------------------------------------

        data.forEach(item => {
            // --- 요약 행/열 필터링 ---
            const machineRaw = getKeyValue(item, '프레스별');
            const shapeRaw = getKeyValue(item, '제품형상');
            
            const isSummaryRow = pivotKeywords.some(keyword => {
                return (shapeRaw && shapeRaw.toLowerCase().includes(keyword)) ||
                       (machineRaw && machineRaw.toLowerCase().includes(keyword));
            });
            
            if (isSummaryRow) return;
            // ------------------------

            // 중량 파싱 (강화된 getKeyValue 사용)
            let weightRaw = getKeyValue(item, '생산중량(양품)');
            let weight = weightRaw ? parseFloat(String(weightRaw).replace(/,/g, '')) : 0;
            if (isNaN(weight)) weight = 0;
            if (weight === 0) return;

            // 기준 데이터 추출 (강화된 getKeyValue 사용)
            let machine = machineRaw ? machineRaw.toUpperCase().trim() : 'Other';
            if (machine === 'R9' || machine === 'R9500') machine = 'RM';
            if (!machines.includes(machine) && machine !== 'RM') machine = 'Other';

            let shape = shapeRaw ? shapeRaw.toUpperCase().trim() : '기타';
            
            // 재질 및 소스 분류 (강화된 getKeyValue 사용)
            const materialRaw = getKeyValue(item, '강종') ? getKeyValue(item, '강종').toUpperCase() : '';
            const typeRaw = getKeyValue(item, '소재타입') ? getKeyValue(item, '소재타입').toUpperCase() : '';
            const ingotTypeRaw = getKeyValue(item, 'INGOT 종류') ? getKeyValue(item, 'INGOT 종류').toUpperCase() : '';

            let categoryKey = '';

            // 재질 대분류 판단
            let materialClass = 'Other';
            if (materialRaw.includes('CARBON') || materialRaw.includes('S355')) materialClass = 'carbon';
            else if (materialRaw.includes('ALLOY') || materialRaw.includes('AISI')) materialClass = 'alloy';
            else if (materialRaw.includes('SUS') || materialRaw.includes('STAINLESS')) materialClass = 'sus';
            else if (materialRaw.includes('TOOL') || materialRaw.includes('SKD')) materialClass = 'tool';

            // 소재 상세 분류 판단
            let sourceSuffix = '';
            if (typeRaw.includes('INGOT')) {
                if (ingotTypeRaw.includes('VSD')) sourceSuffix = '_ingot_vsd';
                else if (ingotTypeRaw.includes('CC')) sourceSuffix = '_ingot_cc';
                else sourceSuffix = '_ingot_ic'; // 기본값 IC
            } else if (typeRaw.includes('R/B') || typeRaw.includes('BLOOM')) {
                sourceSuffix = '_rb';
            } else if (typeRaw.includes('SLAB')) {
                sourceSuffix = '_slab';
            } else {
                 sourceSuffix = '_ingot_ic'; 
            }

            categoryKey = `${materialClass}${sourceSuffix}`;

            // 매트릭스에 누적
            if (!matrix[machine]) matrix[machine] = {};
            if (!matrix[machine][shape]) matrix[machine][shape] = {
                 carbon_ingot_ic: 0, carbon_ingot_vsd: 0, carbon_ingot_cc: 0, carbon_rb: 0, carbon_slab: 0,
                 alloy_ingot_ic: 0, alloy_ingot_vsd: 0, alloy_ingot_cc: 0, alloy_rb: 0, alloy_slab: 0,
                 sus_ingot_ic: 0, sus_ingot_cc: 0, sus_rb: 0, sus_slab: 0,
                 tool_ingot_ic: 0, tool_slab: 0,
            };

            if (matrix[machine][shape][categoryKey] !== undefined) {
                matrix[machine][shape][categoryKey] += weight;
            }
        });

        return matrix;
    }, []);

    const processCSV = useCallback((csvString) => {
        setIsProcessing(true);
        setError(null);
        
        if (typeof Papa === 'undefined') {
            setError('라이브러리 로드 중입니다. 잠시 후 다시 시도해주세요.');
            setIsProcessing(false);
            return;
        }

        Papa.parse(csvString, {
            header: true,
            skipEmptyLines: true,
            complete: (results) => {
                if (results.errors.length) {
                    setError(`CSV 파싱 오류 발생: ${results.errors[0].message}`);
                    setProcessedData(null);
                } else {
                    const actualHeaders = results.meta.fields.filter(h => h).map(h => h.trim());
                    
                    try {
                        const data = aggregateForgingData(results.data, actualHeaders); // 헤더 목록 전달
                        
                        const totalAggregatedWeight = Object.values(data).flatMap(d => Object.values(d)).flatMap(s => Object.values(s)).reduce((sum, current) => sum + current, 0);
                        
                        if (totalAggregatedWeight === 0 && results.data.length > 0) {
                            if (results.data.length > 0) { // 데이터가 있지만 중량이 0일 경우
                                setError(`집계된 중량이 0입니다. RAW DATA 헤더(컬럼명)를 확인해 주세요. 앱이 찾은 헤더: [${actualHeaders.join(', ')}]`);
                            } else {
                                setError(`업로드된 시트에 유효한 데이터 행이 없습니다.`);
                            }
                        }
                        
                        setProcessedData(data);
                    } catch (e) {
                        if (e.message.startsWith('필수 컬럼 누락:')) {
                            setError(e.message + `. (앱이 찾은 헤더: [${actualHeaders.join(', ')}])`);
                        } else {
                            setError(`분석 오류: ${e.message}`);
                        }
                    }
                }
                setIsProcessing(false);
            },
            error: (err) => {
                setError(err.message);
                setIsProcessing(false);
            }
        });
    }, [aggregateForgingData]);

    const handleFileUpload = (event) => {
        const file = event.target.files[0];
        if (!file) return;
        setIsProcessing(true);
        setProcessedData(null);
        
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                if (typeof XLSX === 'undefined') throw new Error('Excel 라이브러리 로드 실패');
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                
                // 'RAW DATA' 시트 찾기
                const rawDataSheetName = workbook.SheetNames.find(name => 
                    name.toUpperCase().includes('RAW DATA')
                );

                let worksheet;
                if (rawDataSheetName) {
                    worksheet = workbook.Sheets[rawDataSheetName];
                } else if (workbook.SheetNames.length > 0) {
                    // Fallback: 'RAW DATA' 시트가 없으면 첫 번째 시트 사용
                    worksheet = workbook.Sheets[workbook.SheetNames[0]];
                } else {
                    throw new Error("파일에 유효한 시트가 없습니다.");
                }
                
                // 시트 데이터를 CSV 문자열로 변환 (헤더 포함)
                const csvString = XLSX.utils.sheet_to_csv(worksheet, { header: 1 });
                
                processCSV(csvString);

            } catch (e) {
                setError(`파일 처리 오류: ${e.message}`);
                setIsProcessing(false);
            }
        };
        reader.readAsArrayBuffer(file);
    };

    useEffect(() => {
        if (inputMethod === 'text' && csvInput) processCSV(csvInput);
    }, [csvInput, inputMethod, processCSV]);

    // --- 1. Excel 다운로드를 위해 데이터를 플랫하게 변환하는 함수 ---
    const getFlattenedDataForDownload = useCallback(() => {
        if (!processedData) return [];
        
        // 공구강(Tool Steel) 컬럼을 추가하여 총 18개 컬럼
        const excelData = [];
        const headers = ["설비", "제품형상", "구분", "탄소강(IC)", "탄소강(VSD)", "탄소강(CC)", "탄소강(R/B)", "탄소강(Slab)", "합금강(IC)", "합금강(VSD)", "합금강(CC)", "합금강(R/B)", "합금강(Slab)", "SUS(IC)", "SUS(R/B)", "SUS(Slab)", "공구강(IC)", "공구강(Slab)"];
        excelData.push(headers);
        
        const machines = ['P15', 'P5', 'P8', 'RM'];
        const targetShapes = ['RING', 'SHAFT', 'DISC', 'SHELL', 'SQUARE', '황지'];

        let totalCarbon = 0;
        let totalAlloy = 0;
        let totalSus = 0;
        let totalTool = 0; // 공구강 총계
        
        machines.forEach(machine => {
            const shapesData = processedData[machine];
            if (!shapesData) return;

            let machineTotalCarbon = 0, machineTotalAlloy = 0, machineTotalSus = 0, machineTotalTool = 0;

            targetShapes.forEach((shape, index) => {
                const row = shapesData[shape];
                
                const machineCell = index === 0 ? machine : '';
                
                if (row) {
                    // 기계별/형상별 총계 계산
                    machineTotalCarbon += row.carbon_ingot_ic + row.carbon_ingot_vsd + row.carbon_ingot_cc + row.carbon_rb + row.carbon_slab;
                    machineTotalAlloy += row.alloy_ingot_ic + row.alloy_ingot_vsd + row.alloy_ingot_cc + row.alloy_rb + row.alloy_slab;
                    machineTotalSus += row.sus_ingot_ic + row.sus_rb + row.sus_slab;
                    machineTotalTool += row.tool_ingot_ic + row.tool_slab;

                    const rowData = [
                        machineCell,
                        shape,
                        "생산중량",
                        row.carbon_ingot_ic, row.carbon_ingot_vsd, row.carbon_ingot_cc, row.carbon_rb, row.carbon_slab,
                        row.alloy_ingot_ic, row.alloy_ingot_vsd, row.alloy_ingot_cc, row.alloy_rb, row.alloy_slab,
                        row.sus_ingot_ic, row.sus_rb, row.sus_slab,
                        row.tool_ingot_ic, row.tool_slab // 공구강 추가
                    ];
                    
                    // 0 값은 Excel에서 빈칸으로 보이도록 변환 (TSV/Excel용)
                    excelData.push(rowData.map(v => (typeof v === 'number' && v === 0 ? '' : v)));
                } else {
                    // 데이터 없는 행도 템플릿 유지를 위해 빈 행 출력
                    excelData.push([machineCell, shape, "생산중량", '', '', '', '', '', '', '', '', '', '', '', '', '', '', '']);
                }
            });
            
            // NOTE: 소계 행 제거됨
            
            // 빈 행 (가독성)
            excelData.push(['', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '']); 
            
            totalCarbon += machineTotalCarbon;
            totalAlloy += machineTotalAlloy;
            totalSus += machineTotalSus;
            totalTool += machineTotalTool;
        });

        // 총합계 행 추가
        excelData.push(["", "총합계", "", totalCarbon, "", "", "", "", totalAlloy, "", "", "", "", totalSus, "", "", totalTool, ""]);
        
        return excelData;
    }, [processedData]);


    // --- 2. 마크다운 보고서 렌더링 함수 (UI 표시용) ---
    const renderForgingReport = () => {
        if (!processedData) return "데이터 분석 대기 중...";

        // 마크다운 헤더 (공구강 컬럼 추가)
        let markdown = "#### 5. 단조설비(프레스/링밀)의 작업중량 및 생산중량 (자동 집계)\n\n";
        markdown += "| 설비 | 제품형상 | 구분 | 탄소강(IC) | 탄소강(VSD) | 탄소강(CC) | 탄소강(R/B) | 탄소강(Slab) | 합금강(IC) | 합금강(VSD) | 합금강(CC) | 합금강(R/B) | 합금강(Slab) | SUS(IC) | SUS(R/B) | SUS(Slab) | 공구강(IC) | 공구강(Slab) |\n";
        markdown += "| :--- | :--- | :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |\n";

        const machines = ['P15', 'P5', 'P8', 'RM']; // 표시 순서
        
        const fmt = (n) => n ? n.toLocaleString('ko-KR') : '-';
        let totalCarbon = 0;
        let totalAlloy = 0;
        let totalSus = 0;
        let totalTool = 0;
        
        let p15CalculatedTotal = 0; // P15 기계의 총합을 별도로 계산
        const p15TargetMachine = 'P15';

        machines.forEach(machine => {
            const shapesData = processedData[machine];
            if (!shapesData) return;

            let machineTotalCarbon = 0, machineTotalAlloy = 0, machineTotalSus = 0, machineTotalTool = 0;

            const targetShapes = ['RING', 'SHAFT', 'DISC', 'SHELL', 'SQUARE', '황지'];
            
            targetShapes.forEach((shape, index) => {
                const row = shapesData[shape];
                
                // 첫 번째 행에만 설비명 표시
                const machineCell = index === 0 ? `**${machine}**` : '';
                
                if (row) {
                    // 기계별/형상별 총계 계산 (accumulate)
                    const rowCarbonTotal = row.carbon_ingot_ic + row.carbon_ingot_vsd + row.carbon_ingot_cc + row.carbon_rb + row.carbon_slab;
                    const rowAlloyTotal = row.alloy_ingot_ic + row.alloy_ingot_vsd + row.alloy_ingot_cc + row.alloy_rb + row.alloy_slab;
                    const rowSusTotal = row.sus_ingot_ic + row.sus_rb + row.sus_slab;
                    const rowToolTotal = row.tool_ingot_ic + row.tool_slab;

                    machineTotalCarbon += rowCarbonTotal;
                    machineTotalAlloy += rowAlloyTotal;
                    machineTotalSus += rowSusTotal;
                    machineTotalTool += rowToolTotal;
                    
                    if (machine === p15TargetMachine) {
                        p15CalculatedTotal += rowCarbonTotal + rowAlloyTotal + rowSusTotal + rowToolTotal;
                    }
                    
                     markdown += `| ${machineCell} | ${shape} | **생산중량** | ${fmt(row.carbon_ingot_ic)} | ${fmt(row.carbon_ingot_vsd)} | ${fmt(row.carbon_ingot_cc)} | ${fmt(row.carbon_rb)} | ${fmt(row.carbon_slab)} | ${fmt(row.alloy_ingot_ic)} | ${fmt(row.alloy_ingot_vsd)} | ${fmt(row.alloy_ingot_cc)} | ${fmt(row.alloy_rb)} | ${fmt(row.alloy_slab)} | ${fmt(row.sus_ingot_ic)} | ${fmt(row.sus_rb)} | ${fmt(row.sus_slab)} | ${fmt(row.tool_ingot_ic)} | ${fmt(row.tool_slab)} |\n`;
                } else {
                     markdown += `| ${machineCell} | ${shape} | 생산중량 | - | - | - | - | - | - | - | - | - | - | - | - | - | - | - |\n`;
                }
            });
            
            // NOTE: 소계 행 제거됨
            
            markdown += `| | | | | | | | | | | | | | | | | | |\n`; // 빈 행

            totalCarbon += machineTotalCarbon;
            totalAlloy += machineTotalAlloy;
            totalSus += machineTotalSus;
            totalTool += machineTotalTool;
        });
        
        // --- P15 총합 진단 메시지 추가 ---
        markdown += `\n**[진단 결과] P15 기계의 총 계산 중량: ${p15CalculatedTotal.toLocaleString('ko-KR')} Kg**\n`;
        // ---------------------------------
        
        // 총합계 행 추가
        markdown += `| **총합계** | | | **${fmt(totalCarbon)}** | | | | | **${fmt(totalAlloy)}** | | | | | **${fmt(totalSus)}** | | | **${fmt(totalTool)}** | |`;

        return markdown;
    };
    
    // --- 3. TSV (탭 구분 텍스트) 생성 함수 ---
    const renderTsvReport = useCallback(() => {
        if (!processedData) return "";
        const data = getFlattenedDataForDownload();
        
        // TSV 형식으로 변환 (탭으로 구분하고 행은 줄바꿈)
        return data.map(row => row.join('\t')).join('\n');
    }, [processedData, getFlattenedDataForDownload]);


    // --- 4. Excel 파일 다운로드 함수 ---
    const handleExcelDownload = () => {
        if (typeof XLSX === 'undefined') {
            setError('Excel 다운로드 라이브러리가 로드되지 않았습니다.');
            return;
        }
        
        const data = getFlattenedDataForDownload();
        if (data.length <= 1) {
             setError('집계된 데이터가 없어 Excel 파일을 생성할 수 없습니다.');
             return;
        }

        const ws = XLSX.utils.aoa_to_sheet(data);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "CBAM_단조공장");
        
        const filename = `CBAM_단조공장_보고서_${new Date().toISOString().slice(0, 10)}.xlsx`;
        XLSX.writeFile(wb, filename);
    };

    // --- 5. TSV 복사 함수 (쉬운 붙여넣기용) ---
    const copyToClipboard = () => {
        const text = renderTsvReport();
        if (navigator.clipboard) {
            navigator.clipboard.writeText(text).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
            }).catch(err => {
                console.error('Failed to copy text: ', err);
            });
        }
    };

    return (
        <div className="min-h-screen bg-slate-50 p-4 sm:p-8 font-sans">
            <div className="max-w-6xl mx-auto bg-white shadow-xl rounded-xl overflow-hidden">
                <div className="bg-slate-800 p-6 text-white flex justify-between items-center">
                    <div>
                        <h1 className="text-2xl font-bold flex items-center gap-2">
                            <Factory className="w-6 h-6 text-yellow-400" />
                            CBAM 단조공장 데이터 분석기
                        </h1>
                        <p className="text-slate-400 text-sm mt-1">RAW DATA를 업로드하면 5번 항목(설비별 생산중량)을 자동 생성합니다.</p>
                    </div>
                    <div className="flex gap-2">
                        <button 
                            onClick={() => setReportMode('forging')}
                            className={`px-4 py-2 rounded-lg text-sm font-bold transition ${reportMode === 'forging' ? 'bg-yellow-500 text-slate-900' : 'bg-slate-700 text-slate-300'}`}
                        >
                            <Hammer className="w-4 h-4 inline mr-1"/> 단조공장
                        </button>
                    </div>
                </div>

                <div className="p-6 space-y-6">
                    {/* 입력 방식 선택 */}
                    <div className="flex gap-4 border-b pb-4">
                         <button onClick={() => setInputMethod('text')} className={`flex items-center gap-2 px-4 py-2 rounded-lg transition ${inputMethod === 'text' ? 'bg-blue-100 text-blue-700 font-bold' : 'text-gray-500 hover:bg-gray-100'}`}>
                            <FileText className="w-4 h-4"/> 텍스트 붙여넣기
                         </button>
                         <button onClick={() => setInputMethod('file')} className={`flex items-center gap-2 px-4 py-2 rounded-lg transition ${inputMethod === 'file' ? 'bg-green-100 text-green-700 font-bold' : 'text-gray-500 hover:bg-gray-100'}`}>
                            <FileUp className="w-4 h-4"/> 엑셀 파일 업로드
                         </button>
                    </div>

                    {/* 입력 영역 */}
                    {inputMethod === 'text' ? (
                        <textarea
                            value={csvInput}
                            onChange={(e) => setCsvInput(e.target.value)}
                            className="w-full h-40 p-4 border rounded-lg font-mono text-xs focus:ring-2 focus:ring-blue-500 outline-none"
                            placeholder="CSV 데이터를 여기에 붙여넣으세요..."
                        />
                    ) : (
                        <div className="border-2 border-dashed border-gray-300 rounded-xl p-8 text-center hover:bg-gray-50 transition">
                            <input type="file" id="file" className="hidden" accept=".xlsx, .xls" onChange={handleFileUpload} />
                            <label htmlFor="file" className="cursor-pointer flex flex-col items-center">
                                <UploadCloud className="w-12 h-12 text-gray-400 mb-2"/>
                                <span className="text-gray-600 font-medium">클릭하여 'RAW DATA' 시트가 포함된 엑셀 파일 업로드</span>
                            </label>
                        </div>
                    )}

                    {/* 에러 메시지 */}
                    {error && (
                        <div className="mb-6 p-4 bg-red-100 border-l-4 border-red-500 text-red-700 rounded-lg flex items-center">
                            <AlertTriangle className="w-5 h-5 mr-3"/> 
                            <span className="font-semibold">오류 진단:</span> {error}
                            <span className="text-xs ml-4">
                                *집계가 0으로 나올 경우, RAW DATA의 컬럼명을 **`생산중량(양품)`**, **`프레스별`**, **`강종`** 등의 기대값과 일치하도록 수정 후 다시 시도해주세요.
                            </span>
                        </div>
                    )}

                    {/* 결과 출력 */}
                    <div className="bg-slate-50 border rounded-xl overflow-hidden">
                        <div className="bg-slate-100 p-3 border-b flex justify-between items-center">
                            <h3 className="font-bold text-slate-700">분석 결과 (Markdown 테이블)</h3>
                            <div className="flex gap-2">
                                <button onClick={copyToClipboard} className="bg-white border hover:bg-gray-50 text-slate-700 px-3 py-1.5 rounded-lg text-sm font-medium flex items-center gap-2 transition">
                                    {copied ? <span className="text-green-600">TSV 복사됨!</span> : <><Copy className="w-4 h-4"/> TSV 복사 (Excel 붙여넣기용)</>}
                                </button>
                                <button onClick={handleExcelDownload} className="bg-indigo-600 text-white hover:bg-indigo-700 px-3 py-1.5 rounded-lg text-sm font-medium flex items-center gap-2 transition">
                                    <Download className="w-4 h-4"/> Excel 다운로드 (.xlsx)
                                </button>
                            </div>
                        </div>
                        <div className="p-0 overflow-x-auto">
                            {isProcessing ? (
                                <div className="p-10 text-center text-gray-500"><Loader className="w-8 h-8 animate-spin mx-auto mb-2"/>분석 중...</div>
                            ) : (
                                <textarea 
                                    readOnly 
                                    value={renderForgingReport()} 
                                    className="w-full h-96 p-4 font-mono text-sm bg-slate-50 resize-none outline-none whitespace-pre"
                                />
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default App;