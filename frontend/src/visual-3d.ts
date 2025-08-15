import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';

@customElement('gdm-live-audio-visuals-3d')
export class GdmLiveAudioVisuals3D extends LitElement {
  @property({ type: Object }) inputNode: GainNode | undefined;
  @property({ type: Object }) outputNode: GainNode | undefined;

  static styles = css`
    :host {
      display: block;
      width: 100%;
      height: 100%;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    }
    
    .visualization {
      width: 100%;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      font-size: 24px;
      opacity: 0.3;
    }
  `;

  render() {
    return html`
      <div class="visualization">
        Audio Visualization
      </div>
    `;
  }
}