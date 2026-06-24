# Founder Photo Update

Дата обновления: 2026-06-24

## Где заменено фото

Новое фото основателя / эксперта подключено в about-блоке главной страницы `index.html`, секция `#about`, блок “Кто стоит за FINMENTOR”.

Ранее использовался один файл:

- `portrait.jpg`

Теперь подключён responsive-набор:

- `portrait-large.webp` / `portrait-large.jpg` — desktop large;
- `portrait-medium.webp` / `portrait-medium.jpg` — desktop medium;
- `portrait-mobile.webp` / `portrait-mobile.jpg` — mobile portrait;
- `portrait-thumb.webp` / `portrait-thumb.jpg` — square thumbnail для будущих author/card-превью;
- `portrait.jpg` — JPG fallback для старых ссылок и браузеров без WebP.

## Принцип кадрирования

Выбран сбалансированный executive-кроп 4:5: лицо и взгляд находятся в верхней смысловой зоне, корпус и скрещённые руки остаются в кадре, лишнее пространство исходного горизонтального снимка убрано. Такой вариант выглядит строже и дороже, чем широкий исходник, но сохраняет естественную осанку и не превращает портрет в чрезмерно крупный headshot.

Обработка минимальная:

- лёгкая коррекция яркости;
- лёгкий контраст;
- мягкое снижение избыточной теплоты;
- аккуратное повышение резкости;
- очень мягкое затемнение краёв, чтобы фон не спорил с лицом.

Лицо, пропорции, одежда и фон не изменялись генеративно.

## Изменённые файлы

- `index.html`
- `style.css`
- `portrait.jpg`
- `portrait-large.jpg`
- `portrait-large.webp`
- `portrait-medium.jpg`
- `portrait-medium.webp`
- `portrait-mobile.jpg`
- `portrait-mobile.webp`
- `portrait-thumb.jpg`
- `portrait-thumb.webp`
- `FOUNDER_PHOTO_UPDATE_REPORT.md`

## Проверка

- Desktop: portrait-блок отрендерен, Chrome выбирает WebP, консоль без ошибок.
- Tablet: portrait-блок отрендерен, горизонтального переполнения нет.
- Mobile: используется `portrait-mobile.webp`, лицо не обрезается, руки и силуэт выглядят естественно.
- Локальные `href`, `src` и `srcset` проверены: битых ссылок нет.
