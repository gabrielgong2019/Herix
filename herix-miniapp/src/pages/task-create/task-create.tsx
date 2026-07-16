import { Component } from 'react';
import { View, Text, Input, Textarea, Picker, Button, Switch } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { tasks } from '../../utils/api';
import './task-create.scss';

interface State {
  title: string;
  description: string;
  requirements: string;
  budget: string;
  commission: string;
  maxHeralds: string;
  mode: number;
  submitting: boolean;
}

const modes = ['STANDARD', 'PERFORMANCE'];

export default class TaskCreate extends Component<{}, State> {
  state: State = {
    title: '',
    description: '',
    requirements: '',
    budget: '',
    commission: '',
    maxHeralds: '1',
    mode: 0,
    submitting: false,
  };

  handleSubmit = async () => {
    const { title, description, budget, commission, maxHeralds, mode } = this.state;

    if (!title || !description || !budget || !commission) {
      Taro.showToast({ title: '请填写必填字段', icon: 'none' });
      return;
    }

    this.setState({ submitting: true });
    try {
      await tasks.create({
        title,
        description,
        requirements: this.state.requirements || undefined,
        budget: Number(budget),
        commission: Number(commission),
        maxHeralds: Number(maxHeralds),
        mode: modes[mode] as 'STANDARD' | 'PERFORMANCE',
      });

      Taro.showToast({ title: '创建成功', icon: 'success' });
      setTimeout(() => Taro.navigateBack(), 1500);
    } catch (err: any) {
      Taro.showToast({ title: err.message || '创建失败', icon: 'none' });
    } finally {
      this.setState({ submitting: false });
    }
  };

  render() {
    const { title, description, requirements, budget, commission, maxHeralds, mode, submitting } = this.state;

    return (
      <View className='create-page'>
        <View className='form-group'>
          <Text className='label'>任务标题 *</Text>
          <Input
            className='input'
            placeholder='例如：Herix 大使计划'
            value={title}
            onInput={e => this.setState({ title: e.detail.value })}
          />
        </View>

        <View className='form-group'>
          <Text className='label'>任务描述 *</Text>
          <Textarea
            className='textarea'
            placeholder='详细描述任务内容、目标受众、期望产出...'
            value={description}
            onInput={e => this.setState({ description: e.detail.value })}
            maxlength={2000}
          />
        </View>

        <View className='form-group'>
          <Text className='label'>要求</Text>
          <Textarea
            className='textarea'
            placeholder='对赫使的要求（粉丝数、风格等）'
            value={requirements}
            onInput={e => this.setState({ requirements: e.detail.value })}
          />
        </View>

        <View className='form-row'>
          <View className='form-group half'>
            <Text className='label'>总预算 (¥) *</Text>
            <Input
              className='input'
              type='digit'
              placeholder='5000'
              value={budget}
              onInput={e => this.setState({ budget: e.detail.value })}
            />
          </View>
          <View className='form-group half'>
            <Text className='label'>单份报酬 (¥) *</Text>
            <Input
              className='input'
              type='digit'
              placeholder='500'
              value={commission}
              onInput={e => this.setState({ commission: e.detail.value })}
            />
          </View>
        </View>

        <View className='form-row'>
          <View className='form-group half'>
            <Text className='label'>所需人数</Text>
            <Input
              className='input'
              type='number'
              placeholder='1'
              value={maxHeralds}
              onInput={e => this.setState({ maxHeralds: e.detail.value })}
            />
          </View>
          <View className='form-group half'>
            <Text className='label'>任务模式</Text>
            <Picker
              mode='selector'
              range={['普通任务', '成果报酬']}
              value={mode}
              onChange={e => this.setState({ mode: Number(e.detail.value) })}
            >
              <View className='picker'>{['普通任务', '成果报酬'][mode]}</View>
            </Picker>
          </View>
        </View>

        <Button
          className='btn-primary'
          onClick={this.handleSubmit}
          loading={submitting}
          disabled={submitting}
        >
          创建任务
        </Button>
      </View>
    );
  }
}
