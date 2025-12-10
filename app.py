import streamlit as st
import pandas as pd
import openpyxl # Excel 파일 처리용
import io

# --- 1. 앱 구성 및 제목 설정 ---
st.set_page_config(
    page_title="CBAM 단조공장 데이터 분석기",
    layout="wide",
    initial_sidebar_state="expanded"
)

st.title("🏭 CBAM 단조공장 데이터 자동 분석기")
st.markdown("---")

# --- 2. 데이터 처리 로직 (Core Logic) ---

REQUIRED_COLUMNS = [
    '생산중량(양품)', '프레스별', '제품형상', 
    '강종', '소재타입', 'INGOT 종류'
]

def get_clean_key(df_columns, target_key):
    """데이터프레임 컬럼에서 공백 및 '합계 :' 접두사를 제거하고 정확한 컬럼명을 찾음"""
    target_key_clean = target_key.strip()
    
    for col in df_columns:
        col_clean = col.strip()
        
        # 1. 정확히 일치하는 경우
        if col_clean == target_key_clean:
            return col
        
        # 2. 피벗 테이블 헤더 접두사 ("합계 : ")가 붙은 경우
        if col_clean.startswith('합계 : ') and target_key_clean in col_clean:
             return col
             
    return None

def clean_and_aggregate(df):
    """데이터프레임을 CBAM 형식으로 집계합니다."""
    
    # 컬럼 헤더 정리 (공백 제거)
    df.columns = [col.strip() for col in df.columns]
    
    # --- 필수 컬럼 존재 유효성 검사 ---
    actual_headers = [col.strip() for col in df.columns if col.strip()]
    missing_columns = [col for col in REQUIRED_COLUMNS if not get_clean_key(actual_headers, col)]
    
    if missing_columns:
        st.error(f"❌ 필수 컬럼 누락: 다음 컬럼들이 RAW DATA에 없습니다: {', '.join(missing_columns)}")
        st.info(f"앱이 찾은 헤더 목록: {', '.join(actual_headers)}")
        return None

    # 매핑 키 이름
    key_weight = get_clean_key(df.columns, '생산중량(양품)')
    key_machine = get_clean_key(df.columns, '프레스별')
    key_shape = get_clean_key(df.columns, '제품형상')
    key_material = get_clean_key(df.columns, '강종')
    key_source_type = get_clean_key(df.columns, '소재타입')
    key_ingot_type = get_clean_key(df.columns, 'INGOT 종류')

    
    matrix = {}
    machines = ['P15', 'P5', 'P8', 'RM']
    shapes = ['RING', 'SHAFT', 'DISC', 'SHELL', 'SQUARE', '황지']

    # Matrix 초기화
    for machine in machines:
        matrix[machine] = {shape: {'carbon_ic': 0, 'carbon_vsd': 0, 'carbon_cc': 0, 'carbon_rb': 0, 'carbon_slab': 0,
                                   'alloy_ic': 0, 'alloy_vsd': 0, 'alloy_cc': 0, 'alloy_rb': 0, 'alloy_slab': 0,
                                   'sus_ic': 0, 'sus_rb': 0, 'sus_slab': 0,
                                   'tool_ic': 0, 'tool_slab': 0} for shape in shapes}

    # 데이터 집계 (반복문)
    pivot_keywords = ['총합계', '합계', '소계', '레이블', 'grand total', 'subtotal']

    for index, row in df.iterrows():
        try:
            # 1. 중량 파싱
            weight = pd.to_numeric(str(row[key_weight]).replace(',', ''), errors='coerce')
            if pd.isna(weight) or weight == 0:
                continue

            # 2. 요약 행 필터링
            if any(keyword in str(row[key_shape]).lower() for keyword in pivot_keywords):
                continue
            
            # 3. 설비 및 제품 형상 분류
            machine = str(row[key_machine]).upper().strip()
            if machine == 'R9' or machine == 'R9500': machine = 'RM'
            if machine not in machines: continue # 정의된 설비만 처리
            
            shape = str(row[key_shape]).upper().strip()
            if shape not in shapes: continue # 정의된 형상만 처리

            # 4. 재질 및 소스 분류
            material_raw = str(row[key_material]).upper()
            type_raw = str(row[key_source_type]).upper()
            ingot_type_raw = str(row[key_ingot_type]).upper()

            material_class = 'other'
            if 'CARBON' in material_raw or 'S355' in material_raw: material_class = 'carbon'
            elif 'ALLOY' in material_raw or 'AISI' in material_raw: material_class = 'alloy'
            elif 'SUS' in material_raw or 'STAINLESS' in material_raw: material_class = 'sus'
            elif 'TOOL' in material_raw or 'SKD' in material_raw: material_class = 'tool'
            else: continue # 미정의 재질 무시

            source_suffix = '_ic' # 기본값
            if 'INGOT' in type_raw:
                if 'VSD' in ingot_type_raw: source_suffix = '_vsd'
                elif 'CC' in ingot_type_raw: source_suffix = '_cc'
                else: source_suffix = '_ic'
            elif 'R/B' in type_raw or 'BLOOM' in type_raw: source_suffix = '_rb'
            elif 'SLAB' in type_raw: source_suffix = '_slab'
            
            category_key = f'{material_class}{source_suffix}'

            # 5. 매트릭스에 중량 누적
            if category_key in matrix[machine][shape]:
                matrix[machine][shape][category_key] += weight

        except Exception as e:
            # 에러 발생 시 로그 기록 또는 무시
            # st.warning(f"데이터 처리 중 오류 발생: {e}") 
            continue
            
    return matrix

# --- 3. UI 및 데이터 입력 ---

uploaded_file = st.file_uploader(
    "1. RAW DATA 파일 (Excel 또는 CSV)을 업로드하세요.", 
    type=['xlsx', 'xls', 'csv']
)

if uploaded_file:
    with st.spinner("파일을 분석하고 데이터를 집계하는 중입니다..."):
        
        # 3.1. 파일 읽기 및 시트 처리 (Excel/CSV 구분)
        data_io = io.BytesIO(uploaded_file.getvalue())
        df = None
        
        try:
            if uploaded_file.name.endswith('.csv'):
                # CSV 파일 처리
                df = pd.read_csv(data_io)
            else:
                # Excel 파일 처리: 시트 이름에 'RAW DATA'가 포함된 시트 우선 찾기
                
                # 엑셀 파일 내의 모든 시트 이름 가져오기
                xls = pd.ExcelFile(data_io)
                sheet_names = xls.sheet_names
                
                target_sheet = None
                
                # 'RAW DATA' 포함 시트 찾기
                for name in sheet_names:
                    if 'RAW DATA' in name.upper():
                        target_sheet = name
                        break
                
                # 'RAW DATA' 시트가 없으면 첫 번째 시트 사용
                if not target_sheet and sheet_names:
                    target_sheet = sheet_names[0]
                
                if target_sheet:
                    st.info(f"✅ 'RAW DATA'를 포함한 시트를 찾았습니다. 시트 '{target_sheet}'를 로드합니다.")
                    df = pd.read_excel(xls, sheet_name=target_sheet)
                else:
                    st.error("❌ 파일 내에 유효한 시트가 없습니다.")
                    
        except Exception as e:
            st.error(f"파일 로드 중 오류가 발생했습니다: {e}")
            df = None
        
        # 3.2. 데이터 정리 및 집계 실행
        if df is not None and not df.empty:
            
            # --- 집계 실행 ---
            aggregated_data = clean_and_aggregate(df)
            
            if aggregated_data:
                st.success("🎉 데이터 분석 및 CBAM 형식 집계가 완료되었습니다!")
                
                # --- 4. 결과 DataFrame 생성 및 표시 ---
                
                final_data = []
                machines = ['P15', 'P5', 'P8', 'RM']
                target_shapes = ['RING', 'SHAFT', 'DISC', 'SHELL', 'SQUARE', '황지']
                
                grand_totals = {key: 0 for key in ['C_IC', 'C_VSD', 'C_CC', 'C_RB', 'C_Slab', 'A_IC', 'A_VSD', 'A_CC', 'A_RB', 'A_Slab', 'S_IC', 'S_RB', 'S_Slab', 'T_IC', 'T_Slab']}
                p15_calculated_total = 0
                
                for machine in machines:
                    shapes_data = aggregated_data.get(machine, {})
                    
                    for index, shape in enumerate(target_shapes):
                        row = shapes_data.get(shape, {})
                        
                        if not row: continue

                        # 데이터 추출 (키 순서 유지)
                        row_data = {
                            "설비": machine if index == 0 else "",
                            "제품형상": shape,
                            "구분": "생산중량",
                            "탄소강(IC)": row.get('carbon_ic', 0), "탄소강(VSD)": row.get('carbon_vsd', 0), "탄소강(CC)": row.get('carbon_cc', 0), "탄소강(R/B)": row.get('carbon_rb', 0), "탄소강(Slab)": row.get('carbon_slab', 0),
                            "합금강(IC)": row.get('alloy_ic', 0), "합금강(VSD)": row.get('alloy_vsd', 0), "합금강(CC)": row.get('alloy_cc', 0), "합금강(R/B)": row.get('alloy_rb', 0), "합금강(Slab)": row.get('alloy_slab', 0),
                            "SUS(IC)": row.get('sus_ic', 0), "SUS(R/B)": row.get('sus_rb', 0), "SUS(Slab)": row.get('sus_slab', 0),
                            "공구강(IC)": row.get('tool_ic', 0), "공구강(Slab)": row.get('tool_slab', 0)
                        }
                        
                        final_data.append(row_data)

                        # 총합계 업데이트
                        current_total = 0
                        grand_totals['C_IC'] += row_data['탄소강(IC)']; current_total += row_data['탄소강(IC)']
                        grand_totals['C_VSD'] += row_data['탄소강(VSD)']; current_total += row_data['탄소강(VSD)']
                        grand_totals['C_CC'] += row_data['탄소강(CC)']; current_total += row_data['탄소강(CC)']
                        grand_totals['C_RB'] += row_data['탄소강(R/B)']; current_total += row_data['탄소강(R/B)']
                        grand_totals['C_Slab'] += row_data['탄소강(Slab)']; current_total += row_data['탄소강(Slab)']
                        
                        grand_totals['A_IC'] += row_data['합금강(IC)']; current_total += row_data['합금강(IC)']
                        grand_totals['A_VSD'] += row_data['합금강(VSD)']; current_total += row_data['합금강(VSD)']
                        grand_totals['A_CC'] += row_data['합금강(CC)']; current_total += row_data['합금강(CC)']
                        grand_totals['A_RB'] += row_data['합금강(R/B)']; current_total += row_data['합금강(R/B)']
                        grand_totals['A_Slab'] += row_data['합금강(Slab)']; current_total += row_data['합금강(Slab)']

                        grand_totals['S_IC'] += row_data['SUS(IC)']; current_total += row_data['SUS(IC)']
                        grand_totals['S_RB'] += row_data['SUS(R/B)']; current_total += row_data['SUS(R/B)']
                        grand_totals['S_Slab'] += row_data['SUS(Slab)']; current_total += row_data['SUS(Slab)']

                        grand_totals['T_IC'] += row_data['공구강(IC)']; current_total += row_data['공구강(IC)']
                        grand_totals['T_Slab'] += row_data['공구강(Slab)']; current_total += row_data['공구강(Slab)']

                        if (machine == 'P15') p15_calculated_total += current_total
                    
                    # 빈 행 추가 (가독성)
                    if index == len(target_shapes) - 1:
                        final_data.append({"설비": "", "제품형상": "", "구분": "", "탄소강(IC)": "", "탄소강(VSD)": "", "탄소강(CC)": "", "탄소강(R/B)": "", "탄소강(Slab)": "",
                                           "합금강(IC)": "", "합금강(VSD)": "", "합금강(CC)": "", "합금강(R/B)": "", "합금강(Slab)": "",
                                           "SUS(IC)": "", "SUS(R/B)": "", "SUS(Slab)": "",
                                           "공구강(IC)": "", "공구강(Slab)": ""})
                
                # 최종 총합계 행 추가
                final_data.append({
                    "설비": "총합계", "제품형상": "", "구분": "",
                    "탄소강(IC)": grand_totals['C_IC'], "탄소강(VSD)": grand_totals['C_VSD'], "탄소강(CC)": grand_totals['C_CC'], "탄소강(R/B)": grand_totals['C_RB'], "탄소강(Slab)": grand_totals['C_Slab'],
                    "합금강(IC)": grand_totals['A_IC'], "합금강(VSD)": grand_totals['A_VSD'], "합금강(CC)": grand_totals['A_CC'], "합금강(R/B)": grand_totals['A_RB'], "합금강(Slab)": grand_totals['A_Slab'],
                    "SUS(IC)": grand_totals['S_IC'], "SUS(R/B)": grand_totals['S_RB'], "SUS(Slab)": grand_totals['S_Slab'],
                    "공구강(IC)": grand_totals['T_IC'], "공구강(Slab)": grand_totals['T_Slab']
                })
                
                # 4.2. Streamlit에 테이블 출력
                st.subheader("2. CBAM 보고서 데이터 테이블")
                st.markdown(f"**[진단 결과] P15 기계의 총 계산 중량: {p15_calculated_total:,.0f} Kg**")
                
                df_result = pd.DataFrame(final_data).fillna('')
                
                # 숫자 포맷 적용 (정수 및 천 단위 구분)
                numeric_cols = [col for col in df_result.columns if '강(' in col or '강(' in col]
                for col in numeric_cols:
                    df_result[col] = df_result[col].apply(lambda x: f"{x:,.0f}" if isinstance(x, (int, float)) and x != 0 else x)
                
                # Streamlit 테이블 출력
                st.dataframe(df_result, hide_index=True)
                
                # --- 5. Excel 다운로드 기능 ---
                
                # CSV/Excel 다운로드 버튼
                csv = df_result.to_csv(index=False).encode('utf-8')
                st.download_button(
                    label="⬇️ CSV 파일로 다운로드 (Excel 호환)",
                    data=csv,
                    file_name='CBAM_단조공장_보고서.csv',
                    mime='text/csv',
                    key='download-csv'
                )
                
            else:
                st.error("데이터 집계에 실패했습니다. 파일 형식을 확인해 주세요.")