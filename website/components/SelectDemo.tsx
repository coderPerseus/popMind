import type { Content } from '../lib/content';
import Icon, { icons } from './Icon';

// The first screen's demo, in CSS only: in a reading window, a phrase is selected, popMind's bubble appears
// under it, the pointer rests on Translate, and the translation opens below; then it starts over. Under
// reduced motion it shows the last moment, still.
export default function SelectDemo(props: { t: Content }) {
  const d = () => props.t.demo;
  return (
    <div class="sel" aria-hidden="true">
      <div class="sel__window">
        <div class="sel__bar">
          <span class="sel__dots">
            <i />
            <i />
            <i />
          </span>
          <span class="sel__app">{d().app}</span>
        </div>
        <div class="sel__doc">
          <span class="sel__ghost" style={{ width: '58%' }} />
          <span class="sel__ghost" style={{ width: '86%' }} />
          <p class="sel__text">
            {d().text}{' '}
            <span class="sel__pick">
              <span class="sel__hl" />
              <span class="sel__word">{d().picked}</span>
              <span class="sel__bubble">
                <span class="sel__grip">
                  <Icon d={icons.grip} size={16} />
                </span>
                <span class="sel__btn sel__btn--hot">
                  <Icon d={icons.languages} size={20} />
                  <span class="sel__tip">{d().tip}</span>
                </span>
                <span class="sel__btn">
                  <Icon d={icons.help} size={20} />
                </span>
                <span class="sel__btn">
                  <Icon d={icons.copy} size={20} />
                </span>
                <span class="sel__btn">
                  <Icon d={icons.message} size={20} />
                </span>
                <span class="sel__sep" />
                <span class="sel__btn">
                  <Icon d={icons.ban} size={20} />
                </span>
                <span class="sel__sep" />
                <img class="sel__logo" src="/icon.png" width="22" height="22" alt="" />
              </span>
              <span class="sel__card">
                <span class="sel__card-head">
                  <span>{d().from}</span>
                  <Icon d={icons.arrowRight} size={16} />
                  <span>{d().to}</span>
                </span>
                <span class="sel__result">{d().result}</span>
                <span class="sel__source">{d().picked}</span>
                <span class="sel__card-foot">
                  <span>{d().engine}</span>
                  <span class="sel__card-acts">
                    <span>
                      <Icon d={icons.volume} size={16} />
                      {d().speak}
                    </span>
                    <span>
                      <Icon d={icons.copy} size={16} />
                      {d().copy}
                    </span>
                  </span>
                </span>
              </span>
            </span>{' '}
            {d().after}
          </p>
          <span class="sel__ghost" style={{ width: '92%' }} />
          <span class="sel__ghost" style={{ width: '74%' }} />
          <span class="sel__ghost" style={{ width: '81%' }} />
          <span class="sel__ghost" style={{ width: '40%' }} />
        </div>
      </div>
    </div>
  );
}
