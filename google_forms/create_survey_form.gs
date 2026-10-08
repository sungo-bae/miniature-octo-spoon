/**
 * '26년 한마음 체육대회 만족도 설문조사 - Google 설문지 자동 생성 스크립트
 *
 * 사용 방법
 *  1. https://script.google.com 에서 [새 프로젝트]를 만듭니다.
 *  2. 기본 코드를 모두 지우고 이 파일 내용을 붙여 넣은 뒤 저장합니다.
 *  3. 위쪽 함수 선택 칸에서 createSurvey 를 고르고 [실행]을 누릅니다.
 *  4. 권한 요청이 나오면 본인 계정으로 허용합니다.
 *  5. [실행 로그]에 나오는 응답 링크와 편집 링크로 설문지를 확인합니다.
 *
 * 모든 척도 문항은 '선형 배율'로 만들어 휴대폰에서 문항이 한 줄씩 넓게 보입니다.
 */

// ===== 척도 설정 (7점으로 바꾸려면 SCALE_MAX 를 7 로) =====
const SCALE_MAX = 5;
const LABEL_LOW = '전혀 그렇지 않다';
const LABEL_HIGH = '매우 그렇다';

const FORM_TITLE = "'26년 한마음 체육대회 만족도 설문조사";
const FORM_DESCRIPTION = [
  '체육대회에 함께해 주신 성도님의 이야기를 들려주세요.',
  '',
  '◆ 설문은 무기명으로 진행되며, 응답 내용은 통계 목적 외에는 사용되지 않습니다.',
  '◆ 정답이나 오답은 없으니 평소 생각하시는 대로 솔직하게 답해 주십시오.',
  '◆ 보내 주신 의견은 다음 체육대회를 준비하는 데 소중히 반영하겠습니다.',
].join('\n');

// ===== 문항 =====
const SECTIONS = [
  {
    title: 'Ⅰ. 체육대회 만족도',
    description: '이번 체육대회의 준비와 운영에 대해 얼마나 만족하셨는지 골라 주십시오.',
    groups: [
      { title: '가. 시설', items: [
        '경기장의 규모와 시설은 경기를 하기에 적절했다.',
        '화장실·휴게 공간 등 편의시설이 충분했다.',
        '체육대회 장소까지 이동하기 편리했다.',
      ]},
      { title: '나. 시간', items: [
        '체육대회 개최 날짜(시기)가 적절했다.',
        '전체 진행 시간의 길이가 적절했다.',
        '경기 일정이 계획한 시간대로 진행되었다.',
      ]},
      { title: '다. 프로그램(종목) 운영', items: [
        '체육대회 종목 구성이 다양하고 흥미로웠다.',
        '남녀노소 모두 참여할 수 있는 종목이었다.',
        '경기 진행과 규칙 안내가 원활했다.',
      ]},
      { title: '라. 식사', items: [
        '식사의 맛과 질이 만족스러웠다.',
        '식사의 양이 충분했다.',
        '배식 방법과 식사 장소가 편리했다.',
      ]},
      { title: '마. 경품', items: [
        '경품의 종류와 품질이 만족스러웠다.',
        '경품의 수량이 적절했다.',
        '경품 추첨과 시상 방식이 공정했다.',
      ]},
      { title: '바. 전반적 만족', items: [
        '전반적으로 이번 체육대회에 만족한다.',
        '이번 체육대회는 기대한 만큼 좋았다.',
        '이번 체육대회에 참가한 것은 잘한 선택이었다.',
      ]},
    ],
  },
  {
    title: 'Ⅱ. 체육대회에 대한 인식',
    description: '체육대회의 의미와 참가하게 된 계기에 대한 질문입니다.',
    groups: [
      { title: '가. 교제·단합력', items: [
        '체육대회를 통해 성도들과의 교제가 깊어졌다.',
        '체육대회를 통해 교회의 단합력이 높아졌다.',
        '평소 잘 모르던 성도와 가까워지는 계기가 되었다.',
      ]},
      { title: '나. 신앙공동체 활동', items: [
        '체육대회는 신앙 공동체의 활동으로 적합하다.',
        '체육대회를 통해 교회에 대한 소속감이 커졌다.',
        '체육대회는 교회 공동체를 세우는 데 의미 있는 행사이다.',
      ]},
      { title: '다. 참가 동기', items: [
        '나는 운동과 건강을 위해 참가했다.',
        '나는 성도들과 즐거운 시간을 보내기 위해 참가했다.',
        '나는 교회 행사에 함께하는 것이 중요하다고 생각해 참가했다.',
      ]},
      { title: '라. 교우의 영향', items: [
        '친한 교우들의 권유가 나의 참가에 영향을 주었다.',
        '소그룹 구성원들이 함께 참가해서 나도 참가하게 되었다.',
        '교우들은 체육대회를 교회의 중요한 행사로 여긴다.',
      ]},
      { title: '마. 사역자·소그룹리더의 영향', items: [
        '담임목사님과 사역자분들의 독려가 나의 참가에 영향을 주었다.',
        '소그룹 리더의 권유가 나의 참가에 영향을 주었다.',
        '사역자와 소그룹 리더들은 체육대회를 중요하게 여긴다.',
      ]},
    ],
  },
  {
    title: 'Ⅲ. 향후 참가 의향',
    description: '앞으로의 교회 체육대회 참여에 대한 질문입니다.',
    groups: [
      { title: null, items: [
        '다음 체육대회에도 참가하고 싶다.',
        '다른 성도에게 체육대회 참가를 추천하겠다.',
        '앞으로 교회 체육대회 준비나 진행에 함께하고 싶다.',
      ]},
    ],
  },
];

const IMPROVEMENT_OPTIONS = [
  '시설', '시간·일정', '종목 구성', '진행 운영', '식사', '경품', '홍보·안내',
];

const DEMOGRAPHICS = [
  { title: '성별', choices: ['남성', '여성'] },
  { title: '연령', choices: ['10대', '20대', '30대', '40대', '50대', '60대 이상'] },
  { title: '신앙 연수', choices: ['5년 미만', '5~10년 미만', '10~20년 미만', '20년 이상'] },
  { title: '이번 체육대회 참가 형태', choices: ['경기 참여', '응원·관람', '봉사·진행'] },
  { title: '이전 교회 체육대회 참가 경험', choices: ['없음', '1회', '2회 이상'] },
];

// ===== 설문지 생성 =====
function createSurvey() {
  const form = FormApp.create(FORM_TITLE);
  form.setDescription(FORM_DESCRIPTION)
      .setProgressBar(true)
      .setCollectEmail(false)
      .setAllowResponseEdits(false)
      .setConfirmationMessage('설문에 응해 주셔서 감사합니다. 하나님의 은혜가 늘 함께하시길 바랍니다.');
  try {
    form.setRequireLogin(false); // 회사·학교 계정에서만 지원
  } catch (e) {}

  let n = 1;

  SECTIONS.forEach((section, i) => {
    const page = form.addPageBreakItem().setTitle(section.title);
    page.setHelpText(section.description + '\n(' + scaleGuide() + ')');

    section.groups.forEach(group => {
      if (group.title) {
        form.addSectionHeaderItem().setTitle(group.title);
      }
      group.items.forEach(text => {
        form.addScaleItem()
            .setTitle(n + '. ' + text)
            .setBounds(1, SCALE_MAX)
            .setLabels(LABEL_LOW, LABEL_HIGH)
            .setRequired(true);
        n++;
      });
    });
  });

  // Ⅳ. 개선 의견
  form.addPageBreakItem().setTitle('Ⅳ. 개선 의견');
  form.addCheckboxItem()
      .setTitle(n++ + '. 다음 체육대회에서 가장 개선이 필요한 부분을 2개까지 골라 주십시오.')
      .setChoiceValues(IMPROVEMENT_OPTIONS)
      .showOtherOption(true)
      .setValidation(FormApp.createCheckboxValidation()
          .setHelpText('2개까지 고를 수 있습니다.')
          .requireSelectAtMost(2)
          .build());
  form.addParagraphTextItem()
      .setTitle(n++ + '. 추가하고 싶은 종목이나 다음 체육대회를 위한 의견을 자유롭게 적어 주십시오.');

  // Ⅴ. 일반 사항
  form.addPageBreakItem()
      .setTitle('Ⅴ. 일반 사항')
      .setHelpText('통계 분석을 위한 질문입니다.');
  DEMOGRAPHICS.forEach((q, i) => {
    form.addMultipleChoiceItem()
        .setTitle((i + 1) + ') ' + q.title)
        .setChoiceValues(q.choices)
        .setRequired(true);
  });

  Logger.log('응답 링크(QR용): ' + form.getPublishedUrl());
  Logger.log('편집 링크: ' + form.getEditUrl());
}

function scaleGuide() {
  const mid = Math.ceil(SCALE_MAX / 2);
  return '1 = ' + LABEL_LOW + ', ' + mid + ' = 보통이다, ' + SCALE_MAX + ' = ' + LABEL_HIGH;
}
