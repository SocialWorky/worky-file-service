import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class AuthService {
  constructor(private readonly jwtService: JwtService) {}

  async validateUser(payload: any): Promise<any> {
    return { userId: payload.id, username: payload.username };
  }

  validateToken(token: string): any {
    try {
      const tokenVerified = this.jwtService.verify(token, {
        secret: process.env.JWT_SECRET,
      });
      return tokenVerified;
    } catch (error) {
      throw new Error('Invalid token');
    }
  }
}
