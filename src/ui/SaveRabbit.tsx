import { Image } from 'expo-image';
import React, { useEffect, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { useColors } from '../theme';
import { useReduceMotion } from './common';

const POSES = [0, 0.16, 0.38, 0.68, 0.83, 1];

export function SaveRabbit({ compact = false }: { compact?: boolean }) {
  const c = useColors();
  const reduceMotion = useReduceMotion();
  const [progress] = useState(() => new Animated.Value(reduceMotion ? 1 : 0));
  const size = compact ? 38 : 76;
  const artSize = size * 1.5;
  const lift = compact ? 4 : 9;

  useEffect(() => {
    if (reduceMotion) {
      progress.setValue(1);
      return;
    }
    progress.setValue(0);
    const hop = Animated.timing(progress, {
      toValue: 1,
      duration: compact ? 430 : 560,
      easing: Easing.linear,
      useNativeDriver: true, isInteraction: false,
    });
    hop.start();
    return () => hop.stop();
  }, [compact, progress, reduceMotion]);

  const translateY = progress.interpolate({ inputRange: POSES, outputRange: [0, lift * 0.32, -lift, 0, -lift * 0.21, 0] });
  const scaleX = progress.interpolate({ inputRange: POSES, outputRange: [1, 1.13, 0.94, 1.12, 0.98, 1] });
  const scaleY = progress.interpolate({ inputRange: POSES, outputRange: [1, 0.86, 1.08, 0.89, 1.02, 1] });

  return (
    <View accessible={false} importantForAccessibility="no-hide-descendants" aria-hidden pointerEvents="none"
      style={[styles.tile, { width: size, height: size, borderRadius: size * 0.29, backgroundColor: c.accent }]}>
      <Animated.View style={{ width: artSize, height: artSize, transform: [{ translateY }, { scaleX }, { scaleY }] }}>
        <Image source={require('../../assets/android-icon-foreground.png')} style={StyleSheet.absoluteFill}
          contentFit="contain" accessible={false} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  tile: { alignItems: 'center', justifyContent: 'center', flexShrink: 0, overflow: 'hidden' },
});
