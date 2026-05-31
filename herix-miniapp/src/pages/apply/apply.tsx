import { Component } from 'react';
import { View, Text, Input, Textarea, Button } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { submissions } from '../../utils/api';
import './apply.scss';

interface State {
  contentUrl: string;
  description: string;
  submitting: boolean;
}

export default class Apply extends Component<{}, State> {
  state: State = {
    contentUrl: '',
    description: '',
    submitting: false,
  };

  handleSubmit = async () => {
    const { contentUrl, description } = this.state;
    if (!contentUrl) {
      Taro.showToast({ title: '请填写内容链接', icon: 'none' });
      return;
    }

    this.setState({ submitting: true });
    try {
      const params = Taro.getCurrentInstance().router?.params;
      const taskId = params?.taskId as string;

      await submissions.submit(taskId, { contentUrl, description });
      Taro.showToast({ title: '提交成功', icon: 'success' });
      setTimeout(() => Taro.navigateBack(), 1500);
    } catch (err: any) {
      Taro.showToast({ title: err.message || '提交失败', icon: 'none' });
    } finally {
      this.setState({ submitting: false });
    }
  };

  render() {
    const { contentUrl, description, submitting } = this.state;

    return (
      <View className='apply-page'>
        <View className='form-group'>
          <Text className='label'>内容链接 *</Text>
          <Input
            className='input'
            placeholder='请粘贴内容链接（小红书/Instagram/抖音等）'
            value={contentUrl}
            onInput={e => this.setState({ contentUrl: e.detail.value })}
          />
        </View>

        <View className='form-group'>
          <Text className='label'>内容说明</Text>
          <Textarea
            className='textarea'
            placeholder='简单描述你的推广内容...'
            value={description}
            onInput={e => this.setState({ description: e.detail.value })}
            maxlength={500}
          />
        </View>

        <Button
          className='btn-primary'
          onClick={this.handleSubmit}
          loading={submitting}
          disabled={submitting}
        >
          提交
        </Button>
      </View>
    );
  }
}
